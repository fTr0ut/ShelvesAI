# Debug/Test Script Requirements

All debug or test scripts that access the database must follow these rules:

- Use `dotenv` with an explicit path to `api/.env` and never hardcode credentials.
- Use only these environment variables for database connections:
  - `POSTGRES_HOST`
  - `POSTGRES_PORT`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DB`
- This is a PRODUCTION database. Scripts must be read-only. Do not write, update, or delete data.
- Do not fall back to default usernames or passwords.
