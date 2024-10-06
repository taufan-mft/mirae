# Mirae
A script that's named Mirae to upload folder to Amazon S3 Glacier using Node.js and Postgresql.

## How it works
Mirae uses AWS SDK v3 S3 Client library, with Postgresql for the database and Prisma for the ORM. How it works is you will provide a root folder path to backup, Mirae will scan the folder recursively and check each file with the DB and compare its checksums, file size, and modified date. If no entry on DB or the properties are different then it gets uploaded to S3.

## How to Run
1. Run `npm i `
2. Create `.env`, see `.env.example` for reference
3. Make sure postgres is running.
4. If this is the first run, you need to run db migration. Run `npx prisma migrate`
5. Finally, run `node .`