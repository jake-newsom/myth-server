require("dotenv").config();
const AIAutomationService = require("../dist/services/aiAutomation.service").default;

async function testAIAutomation() {
  console.log("🧪 Testing AI Automation Service...");
  
  try {
    // Test the automated fate pick generation
    const result = await AIAutomationService.generateAutomatedFatePick();
    
    console.log("\n📊 Test Results:");
    console.log("Success:", result.success);
    console.log("Message:", result.message);
    
    if (result.success) {
      console.log("Fate Pick ID:", result.fatePickId);
      console.log("Set Used:", result.setUsed);
      console.log("Cards Generated:", result.cardsGenerated);
    }
    
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
  
  process.exit(0);
}

testAIAutomation();
