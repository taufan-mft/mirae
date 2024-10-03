const { S3Client, PutObjectCommand, StorageClass } = require('@aws-sdk/client-s3');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto'); // For hash generation and checksum calculation
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const s3Client = new S3Client({
  region: process.env.AWS_REGION
});

// Absolute path to the root folder you want to backup
const rootFolder = path.resolve(process.env.ROOT_FOLDER);

// Function to calculate MD5 checksum (or any other algorithm)
const calculateFileMD5 = async (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5'); // Use md5 for S3 checksum
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('data', (data) => hash.update(data));
    fileStream.on('end', () => resolve(hash.digest('base64'))); // S3 expects base64 encoding for MD5
    fileStream.on('error', reject);
  });
};

// Function to upload a file to S3 using AWS SDK v3 with checksum verification
const uploadFileToS3 = async (filePath, fileHash) => {
  const fileKey = path.relative(rootFolder, filePath);
  const fileStream = fs.createReadStream(filePath);

  // Calculate MD5 checksum for S3 upload
  const checksumMD5 = await calculateFileMD5(filePath);

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileKey,
    Body: fileStream,
    ContentMD5: checksumMD5, // Add MD5 checksum for verification
    Metadata: {
      'file-hash': fileHash // Optionally store a custom hash (SHA-256) as metadata
    },
    StorageClass: StorageClass.GLACIER
  });

  try {
    await s3Client.send(command);
    console.log(`Uploaded: ${fileKey} with MD5 checksum: ${checksumMD5}`);
  } catch (error) {
    console.error(`Failed to upload ${fileKey}:`, error);
  }
};

// Function to recursively backup folder
const backupFolder = async (dirPath) => {
  const files = await fs.readdir(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      await backupFolder(filePath); // Recursive call for directories
    } else {
      const lastModified = new Date(stats.mtime);
      const size = stats.size;

      // Calculate current file hash (SHA-256)
      const currentHash = await calculateFileMD5(filePath); // Change to MD5 for S3 checksum

      // Check the file in the database
      const existingFile = await prisma.file.findUnique({
        where: { path: filePath }
      });

      if (
        !existingFile || 
        existingFile.size !== size || 
        new Date(existingFile.lastModified) < lastModified ||
        existingFile.hash !== currentHash // Compare the hash
      ) {
        // File is new or modified, upload it to S3 with MD5 checksum
        await uploadFileToS3(filePath, currentHash);

        // Upsert the file information in PostgreSQL, including the hash
        await prisma.file.upsert({
          where: { path: filePath },
          update: { size, lastModified, hash: currentHash, uploaded: true },
          create: { path: filePath, size, lastModified, hash: currentHash, uploaded: true }
        });
      } else {
        console.log(`File unchanged: ${filePath}`);
      }
    }
  }
};

// Start the backup process
(async () => {
  try {
    await backupFolder(rootFolder);
    console.log('Backup completed.');
  } catch (error) {
    console.error('Error during backup:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
