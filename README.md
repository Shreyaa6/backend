# Backend Setup Guide

This backend is built with Node.js, Express, Prisma, and MySQL. It's designed to be easily deployable.

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Set Up Environment Variables

Copy the example environment file and fill in your database credentials:

```bash
cp env.example .env
```

Edit `.env` with your MySQL database details (example includes optional shadow DB for Prisma migrations):

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"
# Optional: used by Prisma during migrations
SHADOW_DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE_shadow"

PORT=4000
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"
FRONTEND_URL="http://localhost:5173"
```

If your password has special characters like @ : / ? & %, URL‑encode them.
Example: `P@ss:w/rd?` → `P%40ss%3Aw%2Frd%3F`.

### 3. Create MySQL Database

Make sure MySQL is running and create the database:

```sql
CREATE DATABASE hiraeth_db;
```

Or use your preferred MySQL client to create the database.

### 4. Generate Prisma Client

```bash
npm run prisma:generate
```

### 5. Run Database Migrations

```bash
# Interactive (will ask for a migration name)
npm run prisma:migrate

# Non-interactive example
npx prisma migrate dev --name init
```

This will create the `users` table in your database.

### 6. Start the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will run on `http://localhost:4000` (or the port specified in `.env`).

## API Endpoints

### Authentication

- `POST /api/auth/signup` - Create a new user account
  ```json
  {
    "email": "user@example.com",
    "username": "username",
    "password": "password123"
  }
  ```

- `POST /api/auth/login` - Login user
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```

- `GET /api/auth/me` - Get current user (requires authentication)
  - Headers: `Authorization: Bearer <token>`

### Health & Testing

- `GET /api/health` - Check server status
- `GET /api/test-db` - Test database connection

Quick test from a terminal:
```bash
curl -s http://localhost:4000/api/test-db | jq
```
Expected response:
```json
{ "success": true, "message": "Database connection successful" }
```

If you get a failure, verify raw connectivity and credentials:
- TCP check: `nc -vz HOST PORT` (e.g., `nc -vz crossover.proxy.rlwy.net 45676`)
- MySQL CLI: `mysql -h HOST -P PORT -u USER -p DATABASE`

## Hosting Considerations

### Environment Variables for Production

When deploying, set these environment variables:

- `DATABASE_URL` - Your production MySQL connection string
- `PORT` - Server port (usually provided by hosting platform)
- `JWT_SECRET` - Strong random secret for JWT tokens
- `FRONTEND_URL` - Your frontend URL (for CORS)
- `NODE_ENV` - Set to `production`

### Database Hosting Options

1. **MySQL Hosting Services:**
   - AWS RDS (MySQL)
   - Google Cloud SQL
   - Azure Database for MySQL
   - PlanetScale
   - Railway
   - Render

2. **Connection String Format:**
   ```
   mysql://USER:PASSWORD@HOST:PORT/DATABASE
   ```

### Deployment Platforms

**Backend Hosting Options:**
- **Railway** - Easy deployment, includes MySQL
- **Render** - Free tier available, MySQL addon
- **Heroku** - Requires MySQL addon
- **AWS EC2/Elastic Beanstalk**
- **DigitalOcean App Platform**
- **Vercel** - Serverless functions (may need adjustments)

### Prisma Migration in Production

Before deploying:

```bash
# Generate Prisma Client
npm run prisma:generate

# For production, use migrate deploy instead of migrate dev
npx prisma migrate deploy
```

If using a proxy host (like Railway proxy), you typically do not need SSL params.
If using a direct cloud host that requires SSL, append `?sslaccept=strict` to `DATABASE_URL`.

### Build Scripts

For production, you may want to add a build script:

```json
{
  "scripts": {
    "build": "prisma generate",
    "start": "node server.js"
  }
}
```

## Project Structure

```
backend/
├── server.js          # Main server file (single file approach)
├── prisma/
│   └── schema.prisma  # Database schema
├── package.json       # Dependencies
├── .env              # Environment variables (not in git)
└── env.example       # Example environment file
```

## Troubleshooting

### Database Connection Issues

- Verify MySQL is running (or remote DB service is healthy)
- Check `DATABASE_URL` format and URL‑encoding for special characters
- Ensure the database exists and user has permissions
- Check firewall/VPN/network settings; ensure outbound to `HOST:PORT` is allowed
- For Prisma P1001 (can’t reach DB): confirm host/port, test with `nc -vz HOST PORT`
- If using Prisma migrations, set `SHADOW_DATABASE_URL` (a separate DB name is fine)

### CORS Issues

- Update `FRONTEND_URL` in `.env` to match your frontend URL
- For production, use your actual frontend domain

### Prisma Issues

- Run `npx prisma generate` after schema changes
- Use `npx prisma studio` to view/edit database data
- Check Prisma logs for detailed error messages

## Security Notes

- Never commit `.env` file to git
- Use strong `JWT_SECRET` in production
- Use HTTPS in production
- Validate and sanitize all inputs
- Use environment variables for all secrets
