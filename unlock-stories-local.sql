-- SQL to unlock story campaigns locally for testing
-- Replace 'YOUR_USER_ID' with your actual local user ID

-- First, let's see what user IDs exist locally
-- SELECT user_id, username, email FROM users;

-- Set your user ID here (replace with your actual local user ID)
-- You can find it by running: SELECT user_id, username, email FROM users;

-- Insert story progress for all the stories you've completed in production
-- This will unlock the chain up to "Sun over Steel" Difficulty 5

INSERT INTO user_story_progress (
  user_id, 
  story_id, 
  times_completed, 
  first_completed_at, 
  last_completed_at, 
  best_completion_time, 
  total_attempts,
  created_at,
  updated_at
) VALUES 
-- Replace 'YOUR_USER_ID' with your actual user ID from the SELECT query above

-- Forest Whispers (all difficulties)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Forest Whispers' AND difficulty = 1), 1, NOW(), NOW(), 144, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Forest Whispers' AND difficulty = 2), 1, NOW(), NOW(), 116, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Forest Whispers' AND difficulty = 3), 1, NOW(), NOW(), 114, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Forest Whispers' AND difficulty = 4), 1, NOW(), NOW(), 166, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Forest Whispers' AND difficulty = 5), 1, NOW(), NOW(), 153, 1, NOW(), NOW()),

-- Sun over Steel (difficulties 1-4, but NOT 5 since that's what you're testing)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Sun over Steel' AND difficulty = 1), 1, NOW(), NOW(), 115, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Sun over Steel' AND difficulty = 2), 1, NOW(), NOW(), 99, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Sun over Steel' AND difficulty = 3), 1, NOW(), NOW(), 87, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Sun over Steel' AND difficulty = 4), 1, NOW(), NOW(), 227, 1, NOW(), NOW()),

-- Winter of Ravens (difficulties 1-4)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Winter of Ravens' AND difficulty = 1), 1, NOW(), NOW(), 105, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Winter of Ravens' AND difficulty = 2), 1, NOW(), NOW(), 109, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Winter of Ravens' AND difficulty = 3), 1, NOW(), NOW(), 163, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Winter of Ravens' AND difficulty = 4), 1, NOW(), NOW(), 292, 1, NOW(), NOW()),

-- Hammerfall (difficulties 1-4)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Hammerfall' AND difficulty = 1), 1, NOW(), NOW(), 142, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Hammerfall' AND difficulty = 2), 1, NOW(), NOW(), 171, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Hammerfall' AND difficulty = 3), 1, NOW(), NOW(), 81, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Hammerfall' AND difficulty = 4), 1, NOW(), NOW(), 124, 1, NOW(), NOW()),

-- Tides of Creation (difficulties 1-4)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Tides of Creation' AND difficulty = 1), 1, NOW(), NOW(), 210, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Tides of Creation' AND difficulty = 2), 1, NOW(), NOW(), 70, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Tides of Creation' AND difficulty = 3), 1, NOW(), NOW(), 162, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Tides of Creation' AND difficulty = 4), 1, NOW(), NOW(), 120, 1, NOW(), NOW()),

-- Heart of Fire (difficulties 1-4)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Heart of Fire' AND difficulty = 1), 1, NOW(), NOW(), 95, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Heart of Fire' AND difficulty = 2), 1, NOW(), NOW(), 112, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Heart of Fire' AND difficulty = 3), 1, NOW(), NOW(), 88, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Heart of Fire' AND difficulty = 4), 1, NOW(), NOW(), 169, 1, NOW(), NOW()),

-- Clash of Currents (difficulties 1-4)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Clash of Currents' AND difficulty = 1), 1, NOW(), NOW(), 123, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Clash of Currents' AND difficulty = 2), 1, NOW(), NOW(), 103, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Clash of Currents' AND difficulty = 3), 1, NOW(), NOW(), 69, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Clash of Currents' AND difficulty = 4), 1, NOW(), NOW(), 122, 1, NOW(), NOW()),

-- Twilight Council (difficulties 1-4)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Twilight Council' AND difficulty = 1), 1, NOW(), NOW(), 101, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Twilight Council' AND difficulty = 2), 1, NOW(), NOW(), 123, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Twilight Council' AND difficulty = 3), 1, NOW(), NOW(), 144, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'Twilight Council' AND difficulty = 4), 1, NOW(), NOW(), 99, 1, NOW(), NOW()),

-- When Worlds Collide (difficulties 1-4)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'When Worlds Collide' AND difficulty = 1), 1, NOW(), NOW(), 95, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'When Worlds Collide' AND difficulty = 2), 1, NOW(), NOW(), 133, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'When Worlds Collide' AND difficulty = 3), 1, NOW(), NOW(), 94, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'When Worlds Collide' AND difficulty = 4), 1, NOW(), NOW(), 88, 1, NOW(), NOW()),

-- The Convergence (difficulties 1-4)
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'The Convergence' AND difficulty = 1), 1, NOW(), NOW(), 91, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'The Convergence' AND difficulty = 2), 1, NOW(), NOW(), 103, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'The Convergence' AND difficulty = 3), 1, NOW(), NOW(), 105, 1, NOW(), NOW()),
('YOUR_USER_ID', (SELECT story_id FROM story_mode_config WHERE name = 'The Convergence' AND difficulty = 4), 1, NOW(), NOW(), 116, 1, NOW(), NOW())

ON CONFLICT (user_id, story_id) DO NOTHING;

-- Verify the insertions worked
SELECT 
  smc.name,
  smc.difficulty,
  usp.times_completed,
  usp.created_at
FROM user_story_progress usp
JOIN story_mode_config smc ON usp.story_id = smc.story_id
WHERE usp.user_id = 'YOUR_USER_ID'
ORDER BY smc.order_index;