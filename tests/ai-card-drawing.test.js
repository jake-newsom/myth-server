const fetch = require('node-fetch');

// Configuration - update these values for your environment
const API_URL = process.env.API_URL || 'http://localhost:3000';
const TOKEN = process.env.TOKEN || 'your_jwt_token_here';
const DECK_ID = process.env.DECK_ID || 'your_deck_id_here';

async function testAICardDrawing() {
  console.log('🧪 Testing AI Card Drawing');
  console.log('==========================\n');

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
    console.log(`   Player 1 hand size: ${gameState.game_state.player1.hand.length}`);
    console.log(`   Player 2 (AI) hand size: ${gameState.game_state.player2.hand.length}`);

    // Step 3: Make it AI's turn by placing a card if it's player's turn
    if (gameState.game_state.current_player_id !== '00000000-0000-0000-0000-000000000000') {
      console.log('\n3. Making it AI\'s turn by placing a card...');
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
          } else {
            const errorData = await placeCardResponse.json();
            console.error('❌ Failed to place card:', errorData);
            return;
          }
        } else {
          console.error('❌ No empty positions found on board');
          return;
        }
      } else {
        console.error('❌ No cards in player\'s hand');
        return;
      }
    } else {
      console.log('✅ It\'s already AI\'s turn');
    }

    // Step 4: Get game state after player's move to see AI's current hand
    console.log('\n4. Getting game state after player\'s move...');
    const afterPlayerMoveResponse = await fetch(`${API_URL}/api/games/${gameId}`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      }
    });

    if (afterPlayerMoveResponse.status !== 200) {
      const errorData = await afterPlayerMoveResponse.json();
      console.error('❌ Failed to get game state:', errorData);
      return;
    }

    const afterPlayerMoveState = await afterPlayerMoveResponse.json();
    const aiHandSizeBefore = afterPlayerMoveState.game_state.player2.hand.length;
    console.log(`   AI hand size before AI action: ${aiHandSizeBefore}`);

    // Step 5: Trigger AI action
    console.log('\n5. Triggering AI action...');
    const aiActionResponse = await fetch(`${API_URL}/api/games/${gameId}/ai-action`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      }
    });

    if (aiActionResponse.status !== 200) {
      const errorData = await aiActionResponse.json();
      console.error('❌ Failed to trigger AI action:', errorData);
      return;
    }

    const aiActionData = await aiActionResponse.json();
    console.log('✅ AI action completed successfully');

    // Step 6: Check if AI drew a card
    console.log('\n6. Checking if AI drew a card...');
    const aiHandSizeAfter = aiActionData.game_state.player2.hand.length;
    console.log(`   AI hand size after AI action: ${aiHandSizeAfter}`);

    if (aiHandSizeAfter > aiHandSizeBefore) {
      console.log('✅ AI successfully drew a card!');
      console.log(`   Cards drawn: ${aiHandSizeAfter - aiHandSizeBefore}`);
    } else if (aiHandSizeAfter === aiHandSizeBefore) {
      console.log('⚠️  AI hand size unchanged - this might be correct if:');
      console.log('   - AI had maximum cards in hand');
      console.log('   - AI deck is empty');
      console.log('   - AI placed a card (which would reduce hand size by 1, then draw 1)');
    } else {
      console.log('❌ AI hand size decreased - this might indicate an issue');
    }

    // Step 7: Check for card drawn events
    const cardDrawnEvents = aiActionData.events.filter(event => event.type === 'CARD_DRAWN');
    console.log(`\n7. Card drawn events: ${cardDrawnEvents.length}`);
    
    if (cardDrawnEvents.length > 0) {
      console.log('✅ Card drawn events found in AI action response');
      cardDrawnEvents.forEach((event, index) => {
        console.log(`   Event ${index + 1}: Card ${event.cardId} drawn for player ${event.sourcePlayerId}`);
      });
    } else {
      console.log('⚠️  No card drawn events found - this might be normal if no cards were drawn');
    }

    // Step 8: Check current player after AI action
    const currentPlayerAfter = aiActionData.game_state.current_player_id;
    console.log(`\n8. Current player after AI action: ${currentPlayerAfter}`);
    
    if (currentPlayerAfter === '00000000-0000-0000-0000-000000000000') {
      console.log('⚠️  AI is still the current player - this might indicate the AI didn\'t end its turn');
    } else {
      console.log('✅ AI properly ended its turn');
    }

    console.log('\n🎉 AI card drawing test completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
if (require.main === module) {
  testAICardDrawing();
}

module.exports = { testAICardDrawing }; 