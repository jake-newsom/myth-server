const fetch = require('node-fetch');

// Configuration - update these values for your environment
const API_URL = process.env.API_URL || 'http://localhost:3000';
const TOKEN = process.env.TOKEN || 'your_jwt_token_here';
const DECK_ID = process.env.DECK_ID || 'your_deck_id_here';

async function testRateLimiting() {
  console.log('🧪 Testing Rate Limiting Changes');
  console.log('================================\n');

  try {
    // Step 1: Create a solo game
    console.log('1. Creating a solo game...');
    const createGameResponse = await fetch(`${API_URL}/api/games/solo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({
        deck_id: DECK_ID
      })
    });

    if (createGameResponse.status !== 200) {
      const errorData = await createGameResponse.json();
      console.error('❌ Failed to create game:', errorData);
      return;
    }

    const gameData = await createGameResponse.json();
    const gameId = gameData.game_id;
    console.log(`✅ Game created successfully: ${gameId}`);

    // Step 2: Test moderate rate limiting (game state polling)
    console.log('\n2. Testing moderate rate limiting (game state polling)...');
    const pollingPromises = [];
    
    // Try to make 50 requests in quick succession (should be well within the 120/minute limit)
    for (let i = 0; i < 50; i++) {
      pollingPromises.push(
        fetch(`${API_URL}/api/games/${gameId}`, {
          headers: {
            'Authorization': `Bearer ${TOKEN}`
          }
        })
      );
    }

    const pollingResults = await Promise.all(pollingPromises);
    const successfulPolls = pollingResults.filter(r => r.status === 200).length;
    const failedPolls = pollingResults.filter(r => r.status !== 200).length;

    console.log(`✅ Polling test: ${successfulPolls} successful, ${failedPolls} failed`);
    if (failedPolls === 0) {
      console.log('✅ Moderate rate limiting is working correctly');
    } else {
      console.log('⚠️  Moderate rate limiting might still be too restrictive');
    }

    // Step 3: Test game action rate limiting
    console.log('\n3. Testing game action rate limiting...');
    const gameState = await fetch(`${API_URL}/api/games/${gameId}`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      }
    }).then(r => r.json());

    const playerHand = gameState.game_state.player1.hand;
    if (playerHand.length === 0) {
      console.log('⚠️  No cards in hand, skipping action rate limit test');
      return;
    }

    // Find an empty position
    let emptyPosition = null;
    for (let y = 0; y < 4 && !emptyPosition; y++) {
      for (let x = 0; x < 4 && !emptyPosition; x++) {
        if (!gameState.game_state.board[y][x] || !gameState.game_state.board[y][x].card) {
          emptyPosition = { x, y };
        }
      }
    }

    if (!emptyPosition) {
      console.log('⚠️  No empty positions, skipping action rate limit test');
      return;
    }

    const actionPromises = [];
    
    // Try to make 20 game actions in quick succession (should be well within the 100/10seconds limit)
    for (let i = 0; i < 20; i++) {
      actionPromises.push(
        fetch(`${API_URL}/api/games/${gameId}/actions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
          },
          body: JSON.stringify({
            action_type: 'placeCard',
            user_card_instance_id: playerHand[0],
            position: emptyPosition
          })
        })
      );
    }

    const actionResults = await Promise.all(actionPromises);
    const successfulActions = actionResults.filter(r => r.status === 200).length;
    const failedActions = actionResults.filter(r => r.status !== 200).length;

    console.log(`✅ Action test: ${successfulActions} successful, ${failedActions} failed`);
    if (failedActions === 0) {
      console.log('✅ Game action rate limiting is working correctly');
    } else {
      console.log('⚠️  Game action rate limiting might still be too restrictive');
    }

    // Step 4: Test AI action rate limiting
    console.log('\n4. Testing AI action rate limiting...');
    const aiActionPromises = [];
    
    // Try to make 25 AI action requests in quick succession (should be well within the 30/second limit)
    for (let i = 0; i < 25; i++) {
      aiActionPromises.push(
        fetch(`${API_URL}/api/games/${gameId}/ai-action`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TOKEN}`
          }
        })
      );
    }

    const aiActionResults = await Promise.all(aiActionPromises);
    const successfulAiActions = aiActionResults.filter(r => r.status === 200).length;
    const failedAiActions = aiActionResults.filter(r => r.status !== 200).length;

    console.log(`✅ AI action test: ${successfulAiActions} successful, ${failedAiActions} failed`);
    if (failedAiActions === 0) {
      console.log('✅ AI action rate limiting is working correctly');
    } else {
      console.log('⚠️  AI action rate limiting might still be too restrictive');
    }

    console.log('\n🎉 Rate limiting test completed!');
    console.log('Summary:');
    console.log(`- Moderate rate limit (polling): ${successfulPolls}/50 successful`);
    console.log(`- Game action rate limit: ${successfulActions}/20 successful`);
    console.log(`- AI action rate limit: ${successfulAiActions}/25 successful`);

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testRateLimiting();
}

module.exports = { testRateLimiting }; 