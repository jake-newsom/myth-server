# Viking Vengeance Testing

This directory contains test scripts for the Viking Vengeance game server.

## Phase 5 WebSocket Testing

The `phase5_testing.js` script tests the WebSocket implementation for PvP functionality as outlined in Phase 5 of the project.

### Prerequisites

- Node.js installed
- Running Viking Vengeance server (on localhost:3000 by default)
- At least two test user accounts with valid JWT tokens
- Each user should have at least one valid deck with 20+ cards

### Setup

1. Install the required dependencies:

   ```
   npm install
   ```

2. Update the `TEST_USERS` array in `phase5_testing.js` with your actual test user tokens and deck IDs.

### Running the Tests

```
npm run test:phase5
```

### Test Coverage

The script tests the following functionality:

1. **Socket Server:** Verifies server initialization
2. **WebSocket Authentication:** Tests authenticated and unauthenticated connections
3. **Matchmaking API:** Tests joining, status checking, and leaving matchmaking
4. **Game Room Joining:** Tests players joining their assigned game rooms
5. **Real-Time Game Actions:** Tests turn-based game play, invalid moves, and valid moves
6. **Disconnection Handling:** Tests player disconnection events

### Manual Verification

Some tests require manual verification or actual game data that can't be predicted in advance.
The script guides you through these steps with clear instructions.

### Extending the Tests

To add more tests, simply extend the `runTests` function in `phase5_testing.js` with additional test cases following the established pattern.
