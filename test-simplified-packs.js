const axios = require("axios");

const BASE_URL = "http://localhost:3000";
let authToken = "";
let userId = "";
let setId = "";

async function testSimplifiedPackSystem() {
  console.log("🧪 Testing Simplified Pack System");
  console.log("=".repeat(50));

  try {
    // 1. Register/Login a test user
    console.log("\n1. 👤 Creating test user...");
    const testUsername = `testuser_${Date.now()}`;
    const testEmail = `test_${Date.now()}@example.com`;

    try {
      const registerResponse = await axios.post(
        `${BASE_URL}/api/auth/register`,
        {
          username: testUsername,
          email: testEmail,
          password: "testpassword123",
        }
      );

      authToken = registerResponse.data.data.token;
      userId = registerResponse.data.data.user.user_id;
      console.log(`✅ User created: ${testUsername} (${userId})`);
    } catch (error) {
      if (error.response?.status === 409) {
        // User exists, try to login
        const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
          email: testEmail,
          password: "testpassword123",
        });
        authToken = loginResponse.data.data.token;
        userId = loginResponse.data.data.user.user_id;
        console.log(`✅ User logged in: ${testUsername}`);
      } else {
        throw error;
      }
    }

    // 2. Create a test set
    console.log("\n2. 🎴 Creating test set...");
    const setResponse = await axios.post(
      `${BASE_URL}/api/sets`,
      {
        name: `Test Set ${Date.now()}`,
        description: "A test set for pack opening",
        is_released: true,
      },
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );
    setId = setResponse.data.data.set_id;
    console.log(`✅ Set created: ${setResponse.data.data.name} (${setId})`);

    // 3. Check initial pack count (should be 0)
    console.log("\n3. 📦 Checking initial pack count...");
    const initialPacksResponse = await axios.get(`${BASE_URL}/api/packs`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    console.log(
      `✅ Initial pack count: ${initialPacksResponse.data.data.pack_count}`
    );

    // 4. Give user some packs (simulating admin action)
    console.log("\n4. 🎁 Giving user 3 packs...");
    const givePacksResponse = await axios.post(
      `${BASE_URL}/api/admin/give-packs`,
      {
        userId: userId,
        quantity: 3,
      },
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );
    console.log(
      `✅ Packs given. New count: ${givePacksResponse.data.data.pack_count}`
    );

    // 5. Check pack count after giving packs
    console.log("\n5. 📦 Checking pack count after giving packs...");
    const afterGivePacksResponse = await axios.get(`${BASE_URL}/api/packs`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    console.log(
      `✅ Pack count: ${afterGivePacksResponse.data.data.pack_count}`
    );

    // 6. Try to open a pack (should fail - no cards in set)
    console.log("\n6. 🎲 Attempting to open a pack...");
    try {
      const openPackResponse = await axios.post(
        `${BASE_URL}/api/packs/open`,
        {
          setId: setId,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
      console.log(
        `✅ Pack opened successfully! Got ${openPackResponse.data.data.cards.length} cards`
      );
      console.log(
        `✅ Remaining packs: ${openPackResponse.data.data.remainingPacks}`
      );
    } catch (error) {
      if (error.response?.data?.message?.includes("No cards available")) {
        console.log(
          `⚠️  Pack opening failed (expected): ${error.response.data.message}`
        );
      } else {
        console.log(
          `❌ Pack opening failed unexpectedly: ${
            error.response?.data?.message || error.message
          }`
        );
      }
    }

    // 7. Check pack count after attempted opening
    console.log("\n7. 📦 Checking pack count after opening attempt...");
    const afterOpenResponse = await axios.get(`${BASE_URL}/api/packs`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    console.log(`✅ Pack count: ${afterOpenResponse.data.data.pack_count}`);

    // 8. Set pack count to specific value
    console.log("\n8. 🔧 Setting pack count to 10...");
    const setPackCountResponse = await axios.post(
      `${BASE_URL}/api/admin/set-pack-quantity`,
      {
        userId: userId,
        quantity: 10,
      },
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );
    console.log(
      `✅ Pack count set to: ${setPackCountResponse.data.data.pack_count}`
    );

    // 9. Final pack count check
    console.log("\n9. 📦 Final pack count check...");
    const finalPacksResponse = await axios.get(`${BASE_URL}/api/packs`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    console.log(
      `✅ Final pack count: ${finalPacksResponse.data.data.pack_count}`
    );

    // 10. Try to open more packs than owned (should spend gems)
    console.log("\n10. 💎 Attempting to open 5 packs with only 3 owned (should spend gems for 2)...");
    try {
      const openMultiResponse = await axios.post(
        `${BASE_URL}/api/packs/open`,
        {
          setId: setId,
          count: 5,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
      console.log(`✅ Opened 5 packs. Packs array length: ${openMultiResponse.data.data.packs.length}`);
      console.log(`✅ Remaining packs: ${openMultiResponse.data.data.remainingPacks}`);
      console.log(`✅ Remaining gems: ${openMultiResponse.data.data.remainingGems}`);
    } catch (error) {
      console.log(`❌ Multi-pack open failed: ${error.response?.data?.message || error.message}`);
    }

    // 11. Try to open 10 packs (should apply 10% gem discount)
    console.log("\n11. 💎 Attempting to open 10 packs (should apply discount if not enough owned)...");
    try {
      const openTenResponse = await axios.post(
        `${BASE_URL}/api/packs/open`,
        {
          setId: setId,
          count: 10,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
      console.log(`✅ Opened 10 packs. Packs array length: ${openTenResponse.data.data.packs.length}`);
      console.log(`✅ Remaining packs: ${openTenResponse.data.data.remainingPacks}`);
      console.log(`✅ Remaining gems: ${openTenResponse.data.data.remainingGems}`);
    } catch (error) {
      console.log(`❌ 10-pack open failed: ${error.response?.data?.message || error.message}`);
    }

    // 12. Try to open more packs than possible (should error)
    console.log("\n12. ❌ Attempting to open 1000 packs (should fail)...");
    try {
      const openFailResponse = await axios.post(
        `${BASE_URL}/api/packs/open`,
        {
          setId: setId,
          count: 1000,
        },
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
      console.log(`❌ Unexpected success: ${openFailResponse.data.data}`);
    } catch (error) {
      if (error.response?.data?.message?.includes("Not enough resources")) {
        console.log(`✅ Correctly failed to open too many packs: ${error.response.data.message}`);
      } else {
        console.log(`❌ Unexpected error: ${error.response?.data?.message || error.message}`);
      }
    }

    console.log("\n🎉 All tests completed successfully!");
    console.log("=".repeat(50));
  } catch (error) {
    console.error("❌ Test failed:", error.response?.data || error.message);
  }
}

// Run the test
testSimplifiedPackSystem();
