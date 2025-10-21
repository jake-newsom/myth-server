# AI Automation Service

This document describes the AI Automation Service that automatically generates fate picks for the AI user every 30 minutes.

## Overview

The AI Automation Service runs in the background while the server is running and performs the following actions every 30 minutes:

1. **Choose a random available set** - Selects from all released card sets
2. **Generate a pack** - Creates 5 random cards from the selected set using the same rarity weights as normal pack opening
3. **Create a fate pick** - Creates a fate pick opportunity from the generated pack
4. **Clean up** - Removes the 5 cards from the AI user's collection (since they're now in the fate pick)

## Features

- **Automatic scheduling**: Runs every 30 minutes (1800 seconds)
- **Error handling**: Gracefully handles errors and continues running
- **Logging**: Comprehensive console logging for monitoring
- **Graceful shutdown**: Properly stops when the server shuts down
- **Manual trigger**: Admin endpoint available for testing

## Files Created/Modified

### New Files

- `src/services/aiAutomation.service.ts` - Main automation service
- `scripts/test-ai-automation.js` - Test script for manual testing

### Modified Files

- `src/app.ts` - Added automation service startup and shutdown
- `server.js` - Added automation service startup and shutdown
- `src/api/controllers/admin.controller.ts` - Added manual trigger endpoint
- `src/api/routes/admin.routes.ts` - Added route for manual trigger
- `docs/openapi/admin.openapi.yaml` - Added API documentation

## API Endpoints

### Manual Trigger (Admin)

```
POST /api/admin/trigger-ai-fate-pick
```

Manually triggers the AI fate pick generation for testing purposes.

**Response (Success):**

```json
{
  "status": "success",
  "message": "Successfully created automated fate pick from Norse Mythology",
  "data": {
    "fatePickId": "uuid-of-fate-pick",
    "setUsed": "Norse Mythology",
    "cardsGenerated": 5
  },
  "timestamp": "2025-10-20T12:00:00.000Z"
}
```

## Testing

### Manual Test Script

```bash
node scripts/test-ai-automation.js
```

### Manual API Test

```bash
curl -X POST http://localhost:3000/api/admin/trigger-ai-fate-pick
```

## Prerequisites

1. **AI User**: The AI user must be created first using:

   ```bash
   curl -X POST http://localhost:3000/api/admin/create-ai-user
   ```

2. **Released Sets**: At least one card set must be marked as released and contain cards

3. **Database**: All migrations must be run and the database seeded with cards

## Configuration

The automation service is configured with the following settings:

- **Interval**: 30 minutes (30 _ 60 _ 1000 milliseconds)
- **AI User ID**: `00000000-0000-0000-0000-000000000000`
- **Fate Coin Cost**: 1 fate coin per fate pick
- **Cards per Pack**: 5 cards (standard pack size)

## Monitoring

The service logs all activities to the console:

- `🤖` - Service startup/shutdown
- `🎲` - Set selection
- `📦` - Pack generation
- `✅` - Success messages
- `❌` - Error messages
- `🗑️` - Card cleanup
- `⏰` - Scheduled execution

## Error Handling

The service handles various error conditions:

- AI user not found
- No released sets available
- Sets with no cards
- Database connection issues
- Fate pick creation failures

In case of errors, the service logs the issue and continues running for the next scheduled execution.

## Performance Considerations

- The service uses existing pack opening logic for consistency
- Database operations are optimized with proper indexing
- Memory usage is minimal as no state is maintained between executions
- The 30-minute interval prevents overwhelming the system

## Security

- No authentication required for the manual trigger endpoint (admin testing only)
- The service only operates on the predefined AI user
- No user data is exposed or modified beyond the AI user's collection
