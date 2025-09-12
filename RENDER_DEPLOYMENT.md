# Render.com Deployment Guide

This guide will help you deploy your Node.js Myth Server API to Render.com.

## Prerequisites

1. A [Render.com](https://render.com) account
2. Your code pushed to a Git repository (GitHub, GitLab, or Bitbucket)
3. Environment variables configured

## Deployment Options

### Option 1: Using render.yaml (Recommended)

The repository includes a `render.yaml` file for automated infrastructure as code deployment.

1. **Connect Repository**: In Render dashboard, click "New" → "Blueprint" and connect your repository
2. **Configure**: Render will read `render.yaml` and set up both web service and database
3. **Environment Variables**: Set the required environment variables (see below)
4. **Deploy**: Click deploy and wait for the build to complete

### Option 2: Manual Deployment

1. **Create PostgreSQL Database**:

   - Go to Render dashboard → "New" → "PostgreSQL"
   - Choose your plan (Free tier available)
   - Note the connection details

2. **Create Web Service**:
   - Go to Render dashboard → "New" → "Web Service"
   - Connect your repository
   - Configure build and start commands (see below)

## Required Environment Variables

### Option 1: Using Environment Groups (Recommended)

If you've already set up an environment group (like "staging"), link it to your web service:

1. **In render.yaml**: The configuration already includes `envVarGroups: [staging]`
2. **In Render Dashboard**: Environment groups are automatically linked when using render.yaml
3. **Manual Setup**: Go to your web service → Environment → Link Environment Group → Select "staging"

Your environment group should contain:

| Variable             | Value                | Description                                          |
| -------------------- | -------------------- | ---------------------------------------------------- |
| `JWT_SECRET`         | `your-secure-secret` | JWT signing secret (generate a strong random string) |
| `JWT_EXPIRES_IN`     | `7d`                 | JWT expiration time                                  |
| `BCRYPT_SALT_ROUNDS` | `12`                 | BCrypt salt rounds for password hashing              |

### Option 2: Direct Environment Variables

Alternatively, set these directly in your Render web service environment variables:

| Variable             | Value                | Description                                          |
| -------------------- | -------------------- | ---------------------------------------------------- |
| `NODE_ENV`           | `production`         | Sets production environment                          |
| `DATABASE_URL`       | `postgresql://...`   | Auto-provided by Render PostgreSQL service           |
| `JWT_SECRET`         | `your-secure-secret` | JWT signing secret (generate a strong random string) |
| `JWT_EXPIRES_IN`     | `7d`                 | JWT expiration time                                  |
| `BCRYPT_SALT_ROUNDS` | `12`                 | BCrypt salt rounds for password hashing              |
| `PORT`               | `10000`              | Port number (Render default)                         |

### Automatic Environment Variables

These are automatically set by Render:

- `DATABASE_URL` - Provided when you link a PostgreSQL service
- `NODE_ENV` - Set to `production` in the render.yaml
- `PORT` - Set to `10000` (Render default)

## Build and Start Commands

### Build Command

```bash
npm run render:build
```

### Start Command

```bash
npm run render:start
```

## Database Setup

### 1. Run Migrations

After your web service is deployed and database is connected:

```bash
# Migrations will run automatically with the start command
# But you can also run them manually via Render shell:
npm run migrate:up
```

### 2. Populate Initial Data

To run all the database queries from `database-queries.sql`:

#### Option A: Use the automated script (Recommended)

```bash
# Connect to your Render web service shell and run:
npm run db:run-queries
```

#### Option B: Manual execution

1. Connect to your Render web service shell
2. Run the interactive script:

```bash
node scripts/run-database-queries.js
```

The script will:

- Show you a preview of the queries
- Ask for confirmation before execution
- Execute queries in batches
- Provide detailed progress and error reporting
- Test database connectivity before starting

## Health Checks

Render will automatically monitor your service using these endpoints:

- **Basic Health**: `GET /api/health` (legacy, simple check)
- **Detailed Health**: `GET /api/health/detailed` (comprehensive system check)
- **Liveness Probe**: `GET /api/health/live` (process health)
- **Readiness Probe**: `GET /api/health/ready` (service ready to handle requests)
- **Database Health**: `GET /api/health/database` (database connectivity and table checks)

## Deployment Process

1. **Push Your Code**: Ensure all changes are committed and pushed to your repository

2. **Trigger Deployment**:

   - If auto-deploy is enabled, deployment starts automatically
   - Otherwise, manually trigger deployment in Render dashboard

3. **Monitor Deployment**:

   - Watch the build logs in Render dashboard
   - Build process includes TypeScript compilation
   - Database migrations run automatically on start

4. **Verify Deployment**:
   - Check health endpoints
   - Test API functionality
   - Monitor logs for any issues

## Available NPM Scripts

| Script                   | Description                                   |
| ------------------------ | --------------------------------------------- |
| `npm run render:build`   | Build for production (TypeScript compilation) |
| `npm run render:start`   | Start with migrations                         |
| `npm run render:deploy`  | Alias for build command                       |
| `npm run db:run-queries` | Run database-queries.sql interactively        |
| `npm run db:setup`       | Run migrations + populate data                |
| `npm run migrate:up`     | Run database migrations                       |

## SSL and Security

- SSL is automatically enabled for PostgreSQL connections in production
- Database connections use `rejectUnauthorized: false` for cloud provider compatibility
- Environment variables are encrypted at rest
- Use strong JWT secrets and consider rotating them periodically

## Monitoring and Logs

### Health Monitoring

- Configure Render health checks to use `/api/health/live`
- Set up alerts for service failures
- Monitor response times and error rates

### Log Access

- View real-time logs in Render dashboard
- Use structured logging for better debugging
- Consider log aggregation tools for production

### Performance Monitoring

- Monitor memory usage with `/api/health/detailed`
- Track database query performance
- Set up alerts for high resource usage

## Scaling

### Vertical Scaling

- Upgrade your Render plan for more CPU/memory
- Monitor resource usage in health endpoints

### Database Scaling

- Upgrade PostgreSQL plan for more storage/connections
- Consider read replicas for high-traffic applications

## Troubleshooting

### Build Failures

```bash
# Check TypeScript compilation
npm run build

# Verify dependencies
npm install
```

### Database Connection Issues

```bash
# Test database connectivity
npm run health:database

# Check environment variables
echo $DATABASE_URL
```

### Application Errors

```bash
# Check health endpoints
curl https://your-app.onrender.com/api/health/detailed

# View recent logs in Render dashboard
```

### Common Issues

1. **Environment Variables Not Set**: Ensure all required env vars are configured
2. **Database Not Connected**: Verify DATABASE_URL is set correctly
3. **Build Timeouts**: Consider upgrading to a faster build plan
4. **SSL Certificate Issues**: Usually resolves automatically, wait a few minutes

## Security Best Practices

1. **Environment Variables**: Never commit secrets to version control
2. **Database Access**: Use connection pooling and prepared statements
3. **Rate Limiting**: Monitor and adjust rate limits as needed
4. **CORS Configuration**: Ensure CORS is properly configured for your frontend
5. **JWT Security**: Use strong secrets and appropriate expiration times

## Post-Deployment

1. **Test All Endpoints**: Use the provided Postman collections
2. **Monitor Performance**: Watch for any performance issues
3. **Set Up Monitoring**: Configure alerts and monitoring
4. **Backup Strategy**: Ensure database backups are configured
5. **Update Documentation**: Keep API documentation current

## Support

- **Render Documentation**: https://render.com/docs
- **Render Community**: https://community.render.com
- **PostgreSQL Documentation**: https://www.postgresql.org/docs/

## Next Steps

After successful deployment:

1. Configure your frontend to use the new API endpoint
2. Set up monitoring and alerting
3. Plan for regular security updates
4. Consider implementing CI/CD pipelines
5. Monitor usage and plan for scaling needs
