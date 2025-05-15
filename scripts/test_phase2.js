/**
 * Viking Vengeance: Manual Testing Script for Phase 2
 *
 * This script provides commands to manually test the functionality implemented in Phase 2.
 * Run these commands using your preferred API testing tool (Postman, Insomnia, or curl).
 */

// 1. Test Server Start
console.log("===== TEST SERVER START =====");
console.log("Run the server with: npm run dev");
console.log(
  "Expected: Server starts without errors, and nodemon restarts on file changes"
);
console.log("");
console.log("Test the health endpoint:");
console.log("GET http://localhost:3000/health");
console.log(
  'Expected: 200 OK response with { "status": "UP", "timestamp": "<current-time>" }'
);
console.log("");

// 2. Test User Registration
console.log("===== TEST USER REGISTRATION =====");
console.log("Test successful registration:");
console.log("POST http://localhost:3000/api/auth/register");
console.log("Content-Type: application/json");
console.log(`
{
  "username": "thor_hammer",
  "email": "thor@asgard.com", 
  "password": "mjolnir123"
}
`);
console.log("Expected: 201 Created with user object and JWT token");
console.log("Action: Save the token for protected route testing");
console.log("");

console.log("Test duplicate email:");
console.log("POST http://localhost:3000/api/auth/register");
console.log("Content-Type: application/json");
console.log(`
{
  "username": "thorson",
  "email": "thor@asgard.com", 
  "password": "differentpass123"
}
`);
console.log("Expected: 409 Conflict");
console.log("");

console.log("Test duplicate username:");
console.log("POST http://localhost:3000/api/auth/register");
console.log("Content-Type: application/json");
console.log(`
{
  "username": "thor_hammer",
  "email": "different@asgard.com", 
  "password": "differentpass123"
}
`);
console.log("Expected: 409 Conflict");
console.log("");

console.log("Test missing fields:");
console.log("POST http://localhost:3000/api/auth/register");
console.log("Content-Type: application/json");
console.log(`
{
  "username": "loki_trickster"
}
`);
console.log("Expected: 400 Bad Request");
console.log("");

// 3. Test User Login
console.log("===== TEST USER LOGIN =====");
console.log("Test successful login:");
console.log("POST http://localhost:3000/api/auth/login");
console.log("Content-Type: application/json");
console.log(`
{
  "email": "thor@asgard.com", 
  "password": "mjolnir123"
}
`);
console.log("Expected: 200 OK with user object and JWT token");
console.log("");

console.log("Test incorrect password:");
console.log("POST http://localhost:3000/api/auth/login");
console.log("Content-Type: application/json");
console.log(`
{
  "email": "thor@asgard.com", 
  "password": "wrongpassword"
}
`);
console.log("Expected: 401 Unauthorized");
console.log("");

console.log("Test non-existent email:");
console.log("POST http://localhost:3000/api/auth/login");
console.log("Content-Type: application/json");
console.log(`
{
  "email": "nonexistent@asgard.com", 
  "password": "whatever123"
}
`);
console.log("Expected: 401 Unauthorized");
console.log("");

// 4. Test JWT Protection (need to create a temporary protected route for testing)
console.log("===== TEST JWT PROTECTION =====");
console.log(
  "First, add a temporary protected route for testing in src/api/routes/index.ts:"
);
console.log(`
// Add this middleware import at the top
import authMiddleware from '../middlewares/auth.middleware';

// Add this protected route
router.get('/protected', authMiddleware.authenticateJWT, (req, res) => {
  res.status(200).json({ message: 'You accessed a protected route!', user: req.user });
});
`);
console.log("");

console.log("Test accessing protected route without token:");
console.log("GET http://localhost:3000/api/protected");
console.log("Expected: 401 Unauthorized");
console.log("");

console.log("Test accessing protected route with valid token:");
console.log("GET http://localhost:3000/api/protected");
console.log("Authorization: Bearer <token-from-login-or-register>");
console.log("Expected: 200 OK with message and user info");
console.log("");

console.log("Test accessing protected route with invalid token:");
console.log("GET http://localhost:3000/api/protected");
console.log("Authorization: Bearer invalidtoken123");
console.log("Expected: 401 Unauthorized");
console.log("");

// 5. Database Verification
console.log("===== DATABASE VERIFICATION =====");
console.log("Run these SQL queries to verify database operations:");
console.log("");

console.log("Check if user was created:");
console.log("SELECT * FROM \"Users\" WHERE username = 'thor_hammer';");
console.log("Expected: User record with hashed password");
console.log("");

console.log("Check if starter cards were created:");
console.log(
  "SELECT * FROM \"UserCardInstances\" WHERE user_id = '<user_id_from_above_query>';"
);
console.log("Expected: ~20 card instance records for the user");
console.log("");

console.log("Check if starter deck was created:");
console.log(
  "SELECT * FROM \"Decks\" WHERE user_id = '<user_id_from_above_query>';"
);
console.log('Expected: A deck named "Valiant Starter Deck"');
console.log("");

console.log("Check if deck cards were assigned:");
console.log(
  'SELECT * FROM "DeckCards" dc JOIN "Decks" d ON dc.deck_id = d.deck_id WHERE d.user_id = \'<user_id_from_above_query>\';'
);
console.log("Expected: ~20 deck card records linking to user card instances");
console.log("");

console.log("===== END OF TEST SCRIPT =====");
console.log(
  "Complete the checklist in phase2.md section 4 based on test results"
);
