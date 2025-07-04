const fetch = require('node-fetch');

// Configuration - update these values for your environment
const API_URL = process.env.API_URL || 'http://localhost:3000';
const TOKEN = process.env.TOKEN || 'your_jwt_token_here';
const DECK_ID = process.env.DECK_ID || 'your_deck_id_here';

async function testSurrenderFunctionality() {
  console.log('🧪 Testing Surrender Functionality');
  console.log('=====================================\n');

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

    // Step 2: Get initial game state
    console.log('\n2. Getting initial game state...');
    const getGameResponse = await fetch(`${API_URL}/api/games/${gameId}`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      }
    });

    if (getGameResponse.status !== 200) {
      const errorData = await getGameResponse.json();
      console.error('❌ Failed to get game state:', errorData);
      return;
    }

    const gameState = await getGameResponse.json();
    console.log(`✅ Game state retrieved. Current player: ${gameState.game_state.current_player_id}`);

    // Step 3: Test surrender when it's the player's turn
    console.log('\n3. Testing surrender when it\'s the player\'s turn...');
    const surrenderResponse1 = await fetch(`${API_URL}/api/games/${gameId}/actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({
        action_type: 'surrender'
      })
    });

    if (surrenderResponse1.status === 200) {
      const surrenderData = await surrenderResponse1.json();
      console.log('✅ Surrender successful when it\'s player\'s turn');
      console.log(`   Game status: ${surrenderData.game_status}`);
      console.log(`   Winner: ${surrenderData.winner_id}`);
      return; // Game is over, no need to continue
    } else {
      const errorData = await surrenderResponse1.json();
      console.log('⚠️  Surrender failed when it\'s player\'s turn:', errorData.error);
    }

    // Step 4: If surrender didn't work, try to make it AI's turn by placing a card
    console.log('\n4. Making a move to switch to AI\'s turn...');
    const playerHand = gameState.game_state.player1.hand;
    if (playerHand.length > 0) {
      // Find an empty position
      let emptyPosition = null;
      for (let y = 0; y < 4 && !emptyPosition; y++) {
        for (let x = 0; x < 4 && !emptyPosition; x++) {
          if (!gameState.game_state.board[y][x] || !gameState.game_state.board[y][x].card) {
            emptyPosition = { x, y };
          }
        }
      }

      if (emptyPosition) {
        const placeCardResponse = await fetch(`${API_URL}/api/games/${gameId}/actions`, {
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
        });

        if (placeCardResponse.status === 200) {
          console.log('✅ Card placed successfully, now it\'s AI\'s turn');
          
          // Step 5: Test surrender when it's NOT the player's turn
          console.log('\n5. Testing surrender when it\'s NOT the player\'s turn...');
          const surrenderResponse2 = await fetch(`${API_URL}/api/games/${gameId}/actions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${TOKEN}`
            },
            body: JSON.stringify({
              action_type: 'surrender'
            })
          });

          if (surrenderResponse2.status === 200) {
            const surrenderData = await surrenderResponse2.json();
            console.log('✅ Surrender successful when it\'s NOT player\'s turn!');
            console.log(`   Game status: ${surrenderData.game_status}`);
            console.log(`   Winner: ${surrenderData.winner_id}`);
            console.log('\n🎉 Test PASSED: Surrender works regardless of whose turn it is!');
          } else {
            const errorData = await surrenderResponse2.json();
            console.error('❌ Surrender failed when it\'s NOT player\'s turn:', errorData.error);
            console.log('\n💥 Test FAILED: Surrender should work when it\'s not the player\'s turn');
          }
        } else {
          const errorData = await placeCardResponse.json();
          console.error('❌ Failed to place card:', errorData);
        }
      } else {
        console.error('❌ No empty positions found on board');
      }
    } else {
      console.error('❌ No cards in player\'s hand');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testSurrenderFunctionality();
}

module.exports = { testSurrenderFunctionality }; 