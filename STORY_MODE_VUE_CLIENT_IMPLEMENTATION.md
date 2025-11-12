# Story Mode Implementation Guide for Vue.js TypeScript Client

This guide provides a complete implementation plan for integrating the Story Mode feature into your Vue.js TypeScript client application.

## Table of Contents

1. [TypeScript Types](#typescript-types)
2. [API Service Layer](#api-service-layer)
3. [Vue Component Structure](#vue-component-structure)
4. [Navigation Flow](#navigation-flow)
5. [State Management](#state-management)
6. [UI/UX Considerations](#uiux-considerations)
7. [Integration with Game Flow](#integration-with-game-flow)
8. [Error Handling](#error-handling)
9. [Testing Checklist](#testing-checklist)

---

## TypeScript Types

Create a new file `src/types/storyMode.types.ts`:

```typescript
// Story Mode Client Types

// Difficulty levels: 1-5 (corresponds to AI card levels)
export type StoryDifficulty = 1 | 2 | 3 | 4 | 5;

// Chapter information (for grouping and display)
export interface ChapterInfo {
  chapter_number: number;
  theme: string;
  boss_name: string;
}

export type RewardType =
  | "first_win"
  | "repeat_win"
  | "achievement"
  | "milestone";

export interface UnlockRequirements {
  prerequisite_stories?: string[];
  min_user_level?: number;
  required_achievements?: string[];
  min_total_story_wins?: number;
  custom_conditions?: Record<string, any>;
}

export interface RewardData {
  gold?: number;
  gems?: number;
  fate_coins?: number;
  card_fragments?: number;
  specific_cards?: string[];
  random_cards?: {
    count: number;
    rarity?: string;
    set_id?: string;
  };
  packs?: {
    set_id: string;
    count: number;
  }[];
  card_xp?: number;
  achievements?: string[];
  custom_rewards?: Record<string, any>;
}

export interface StoryModeConfig {
  story_id: string;
  name: string;
  description?: string;
  difficulty: StoryDifficulty; // Numeric: 1-5
  chapter_number?: number; // Optional: 1-10 for chapter grouping
  ai_deck_id: string;
  order_index: number;
  is_active: boolean;
  unlock_requirements: UnlockRequirements;
  created_at: string;
  updated_at: string;
}

export interface StoryModeReward {
  reward_id: string;
  story_id: string;
  reward_type: RewardType;
  reward_data: RewardData;
  is_active: boolean;
  created_at: string;
}

export interface UserStoryProgress {
  progress_id: string;
  user_id: string;
  story_id: string;
  times_completed: number;
  first_completed_at?: string;
  last_completed_at?: string;
  best_completion_time?: number;
  total_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface StoryModeWithRewards extends StoryModeConfig {
  rewards: StoryModeReward[];
}

export interface StoryModeWithProgress extends StoryModeWithRewards {
  user_progress?: UserStoryProgress;
  is_unlocked: boolean;
  can_play: boolean;
  chapter_info?: ChapterInfo; // Optional chapter metadata for grouping
}

// Helper type for grouping story modes by chapter
export interface ChapterGroup {
  chapter_number: number;
  theme: string;
  boss_name: string;
  difficulties: StoryModeWithProgress[]; // Array of 5 difficulties (levels 1-5)
  is_mastered: boolean; // True if all 5 difficulties completed
  completion_count: number; // Number of completed difficulties (0-5)
}

// API Request Types
export interface StoryGameStartRequest {
  story_id: string;
  player_deck_id: string;
}

export interface StoryGameCompletionRequest {
  story_id: string;
  game_result: any;
  completion_time_seconds?: number;
}

// API Response Types
export interface StoryModeListResponse {
  story_modes: StoryModeWithProgress[];
  total_count: number;
}

export interface StoryGameStartResponse {
  message: string;
  game_id: string;
  story_config: StoryModeConfig;
  ai_deck_preview?: {
    name: string;
    card_count: number;
  };
}

export interface StoryGameCompletionRewards {
  message: string;
  rewards_earned: RewardData;
  is_first_win: boolean;
  new_progress: UserStoryProgress;
  unlocked_stories?: string[];
}

export interface UnlockStatusResponse {
  story_id: string;
  is_unlocked: boolean;
}

export interface UserProgressResponse {
  progress: UserStoryProgress | UserStoryProgress[];
}

// Error Response Type
export interface StoryModeErrorResponse {
  error: string;
}
```

---

## API Service Layer

Create `src/services/storyMode.service.ts`:

```typescript
import {
  StoryModeListResponse,
  StoryGameStartRequest,
  StoryGameStartResponse,
  StoryGameCompletionRequest,
  StoryGameCompletionRewards,
  UnlockStatusResponse,
  UserProgressResponse,
  StoryModeErrorResponse,
} from "@/types/storyMode.types";
import { apiClient } from "@/utils/api"; // Adjust import based on your API client setup

export class StoryModeService {
  // Note: If your apiClient already has '/api' as the base URL, use '/story-modes' instead
  // If your apiClient doesn't have a base URL, use '/api/story-modes'
  private static readonly BASE_URL = "/story-modes";

  /**
   * Fetch all available story modes with user progress
   */
  static async getAvailableStoryModes(): Promise<StoryModeListResponse> {
    try {
      const response = await apiClient.get<StoryModeListResponse>(
        this.BASE_URL
      );
      return response.data;
    } catch (error: any) {
      throw this.handleError(error, "Failed to fetch story modes");
    }
  }

  /**
   * Start a story mode game
   */
  static async startStoryGame(
    request: StoryGameStartRequest
  ): Promise<StoryGameStartResponse> {
    try {
      const response = await apiClient.post<StoryGameStartResponse>(
        `${this.BASE_URL}/start`,
        request
      );
      return response.data;
    } catch (error: any) {
      throw this.handleError(error, "Failed to start story game");
    }
  }

  /**
   * Get user's progress for all story modes or a specific one
   */
  static async getUserProgress(
    storyId?: string
  ): Promise<UserProgressResponse> {
    try {
      const url = storyId
        ? `${this.BASE_URL}/progress/${storyId}`
        : `${this.BASE_URL}/progress`;
      const response = await apiClient.get<UserProgressResponse>(url);
      return response.data;
    } catch (error: any) {
      throw this.handleError(error, "Failed to fetch user progress");
    }
  }

  /**
   * Process story mode game completion
   */
  static async processStoryCompletion(
    request: StoryGameCompletionRequest
  ): Promise<StoryGameCompletionRewards> {
    try {
      const response = await apiClient.post<StoryGameCompletionRewards>(
        `${this.BASE_URL}/complete`,
        request
      );
      return response.data;
    } catch (error: any) {
      throw this.handleError(error, "Failed to process story completion");
    }
  }

  /**
   * Check if a story mode is unlocked for the user
   */
  static async checkUnlockStatus(
    storyId: string
  ): Promise<UnlockStatusResponse> {
    try {
      const response = await apiClient.get<UnlockStatusResponse>(
        `${this.BASE_URL}/${storyId}/unlock-status`
      );
      return response.data;
    } catch (error: any) {
      throw this.handleError(error, "Failed to check unlock status");
    }
  }

  /**
   * Helper method to fetch AI deck cards for preview
   * Note: You may need to create an endpoint for this or use existing deck endpoints
   */
  static async getDeckPreview(deckId: string): Promise<any> {
    try {
      // Adjust this based on your existing deck API structure
      // Note: If your apiClient already has '/api' as base URL, use '/decks/${deckId}' instead
      const response = await apiClient.get(`/decks/${deckId}`);
      return response.data;
    } catch (error: any) {
      console.warn("Failed to fetch deck preview:", error);
      return null;
    }
  }

  private static handleError(error: any, defaultMessage: string): Error {
    if (error.response?.data?.error) {
      return new Error(error.response.data.error);
    }
    return new Error(error.message || defaultMessage);
  }
}
```

---

## Vue Component Structure

### 1. Story Mode List Component

Create `src/views/StoryModeListView.vue`:

```vue
<template>
  <div class="story-mode-list-view">
    <!-- Header -->
    <div class="story-mode-header">
      <button class="back-button" @click="goBack">
        <Icon name="arrow-left" />
        Back
      </button>
      <h1>Story Mode</h1>
      <p class="subtitle">Challenge legendary opponents and earn rewards</p>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <LoadingSpinner />
      <p>Loading story modes...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <Icon name="alert-circle" />
      <p>{{ error }}</p>
      <button @click="loadStoryModes" class="retry-button">Retry</button>
    </div>

    <!-- Story Mode List -->
    <div v-else class="story-mode-list">
      <StoryModeCard
        v-for="storyMode in storyModes"
        :key="storyMode.story_id"
        :story-mode="storyMode"
        :selected-deck-id="selectedDeckId"
        @select="handleStoryModeSelect"
      />
    </div>

    <!-- Empty State -->
    <div
      v-if="!loading && !error && storyModes.length === 0"
      class="empty-state"
    >
      <Icon name="book-open" />
      <p>No story modes available</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { StoryModeService } from "@/services/storyMode.service";
import { StoryModeWithProgress } from "@/types/storyMode.types";
import StoryModeCard from "@/components/storyMode/StoryModeCard.vue";
import LoadingSpinner from "@/components/common/LoadingSpinner.vue";
import Icon from "@/components/common/Icon.vue";
import { useDeckStore } from "@/stores/deck"; // Adjust based on your store structure

const router = useRouter();
const deckStore = useDeckStore();

const storyModes = ref<StoryModeWithProgress[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const selectedDeckId = computed(() => deckStore.selectedDeckId);

onMounted(() => {
  loadStoryModes();
});

async function loadStoryModes() {
  loading.value = true;
  error.value = null;

  try {
    const response = await StoryModeService.getAvailableStoryModes();
    storyModes.value = response.story_modes;
  } catch (err: any) {
    error.value = err.message || "Failed to load story modes";
    console.error("Error loading story modes:", err);
  } finally {
    loading.value = false;
  }
}

function handleStoryModeSelect(storyMode: StoryModeWithProgress) {
  if (!selectedDeckId.value) {
    // Show deck selection modal or navigate to deck selection
    alert("Please select a deck first");
    return;
  }

  if (!storyMode.can_play) {
    // Show unlock requirements modal
    showUnlockRequirements(storyMode);
    return;
  }

  // Navigate to game or start game directly
  startStoryGame(storyMode);
}

async function startStoryGame(storyMode: StoryModeWithProgress) {
  if (!selectedDeckId.value) return;

  try {
    const response = await StoryModeService.startStoryGame({
      story_id: storyMode.story_id,
      player_deck_id: selectedDeckId.value,
    });

    // Navigate to game screen with game_id
    router.push({
      name: "Game",
      params: { gameId: response.game_id },
      query: { mode: "story", storyId: storyMode.story_id },
    });
  } catch (err: any) {
    alert(err.message || "Failed to start story game");
    console.error("Error starting story game:", err);
  }
}

function showUnlockRequirements(storyMode: StoryModeWithProgress) {
  const reqs = storyMode.unlock_requirements;
  let message = `This story mode is locked.\n\n`;

  if (reqs.min_user_level) {
    message += `Requires level ${reqs.min_user_level}\n`;
  }
  if (reqs.min_total_story_wins) {
    message += `Requires ${reqs.min_total_story_wins} total story wins\n`;
  }
  if (reqs.prerequisite_stories?.length) {
    message += `Must complete ${reqs.prerequisite_stories.length} prerequisite story modes\n`;
  }

  alert(message);
}

function goBack() {
  router.back();
}
</script>

<style scoped lang="scss">
.story-mode-list-view {
  padding: 1rem;
  max-width: 1200px;
  margin: 0 auto;
}

.story-mode-header {
  margin-bottom: 2rem;

  .back-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: var(--hover-bg);
    }
  }

  h1 {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 1rem;
  }
}

.loading-container,
.error-container,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  text-align: center;

  p {
    margin-top: 1rem;
    color: var(--text-secondary);
  }
}

.error-container {
  .retry-button {
    margin-top: 1rem;
    padding: 0.75rem 1.5rem;
    background: var(--primary-color);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
}

.story-mode-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
}
</style>
```

### 2. Story Mode Card Component

Create `src/components/storyMode/StoryModeCard.vue`:

```vue
<template>
  <div
    class="story-mode-card"
    :class="{
      locked: !storyMode.can_play,
      completed: isCompleted,
      new: isNewlyUnlocked,
    }"
    @click="handleClick"
  >
    <!-- Lock Overlay -->
    <div v-if="!storyMode.can_play" class="lock-overlay">
      <Icon name="lock" size="2rem" />
      <span>Locked</span>
    </div>

    <!-- Card Header -->
    <div class="card-header">
      <div class="difficulty-badge" :class="difficultyClass">
        {{ difficultyLabel }}
      </div>
      <div v-if="isCompleted" class="completed-badge">
        <Icon name="check-circle" />
        Completed
      </div>
    </div>

    <!-- Story Mode Info -->
    <div class="card-content">
      <h3 class="story-name">{{ storyMode.name }}</h3>
      <p v-if="storyMode.description" class="story-description">
        {{ storyMode.description }}
      </p>

      <!-- Deck Preview -->
      <div class="deck-preview">
        <h4>Opponent Deck</h4>
        <div v-if="deckPreviewLoading" class="deck-loading">
          <LoadingSpinner size="small" />
        </div>
        <div v-else-if="deckPreviewCards.length > 0" class="deck-cards">
          <CardPreview
            v-for="(card, index) in previewCards"
            :key="card?.card_id || index"
            :card="card"
            :size="'small'"
          />
          <div v-if="deckPreviewCards.length > 3" class="more-cards">
            +{{ deckPreviewCards.length - 3 }}
          </div>
        </div>
        <div v-else class="deck-placeholder">
          <Icon name="cards" />
          <span>{{
            storyMode.ai_deck_id ? "Deck Preview" : "No deck info"
          }}</span>
        </div>
      </div>

      <!-- Progress Info -->
      <div v-if="storyMode.user_progress" class="progress-info">
        <div class="progress-stat">
          <Icon name="trophy" />
          <span>{{ storyMode.user_progress.times_completed }} Wins</span>
        </div>
        <div
          v-if="storyMode.user_progress.best_completion_time"
          class="progress-stat"
        >
          <Icon name="clock" />
          <span
            >Best:
            {{ formatTime(storyMode.user_progress.best_completion_time) }}</span
          >
        </div>
        <div class="progress-stat">
          <Icon name="target" />
          <span>{{ storyMode.user_progress.total_attempts }} Attempts</span>
        </div>
      </div>

      <!-- Rewards Preview -->
      <div class="rewards-preview">
        <h4>First Win Rewards</h4>
        <div class="rewards-list">
          <div v-if="firstWinReward?.reward_data.gold" class="reward-item">
            <Icon name="coin" />
            <span>{{ firstWinReward.reward_data.gold }} Gold</span>
          </div>
          <div v-if="firstWinReward?.reward_data.gems" class="reward-item">
            <Icon name="gem" />
            <span>{{ firstWinReward.reward_data.gems }} Gems</span>
          </div>
          <div
            v-if="firstWinReward?.reward_data.fate_coins"
            class="reward-item"
          >
            <Icon name="fate-coin" />
            <span>{{ firstWinReward.reward_data.fate_coins }} Fate Coins</span>
          </div>
          <div v-if="firstWinReward?.reward_data.card_xp" class="reward-item">
            <Icon name="xp" />
            <span>{{ firstWinReward.reward_data.card_xp }} XP</span>
          </div>
        </div>
      </div>

      <!-- Unlock Requirements (if locked) -->
      <div v-if="!storyMode.can_play" class="unlock-requirements">
        <h4>Unlock Requirements</h4>
        <ul>
          <li v-if="storyMode.unlock_requirements.min_user_level">
            Reach level {{ storyMode.unlock_requirements.min_user_level }}
          </li>
          <li v-if="storyMode.unlock_requirements.min_total_story_wins">
            Win {{ storyMode.unlock_requirements.min_total_story_wins }} story
            matches
          </li>
          <li v-if="storyMode.unlock_requirements.prerequisite_stories?.length">
            Complete
            {{
              storyMode.unlock_requirements.prerequisite_stories.length
            }}
            prerequisite story{{
              storyMode.unlock_requirements.prerequisite_stories.length > 1
                ? "ies"
                : ""
            }}
          </li>
        </ul>
      </div>
    </div>

    <!-- Action Button -->
    <div class="card-footer">
      <button
        class="play-button"
        :disabled="!storyMode.can_play || !selectedDeckId"
        :class="{ disabled: !storyMode.can_play || !selectedDeckId }"
      >
        <Icon name="play" />
        <span>{{ storyMode.can_play ? "Play" : "Locked" }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { StoryModeWithProgress } from "@/types/storyMode.types";
import { StoryModeService } from "@/services/storyMode.service";
import CardPreview from "@/components/cards/CardPreview.vue"; // Adjust based on your component structure
import LoadingSpinner from "@/components/common/LoadingSpinner.vue";
import Icon from "@/components/common/Icon.vue";

interface Props {
  storyMode: StoryModeWithProgress;
  selectedDeckId?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  select: [storyMode: StoryModeWithProgress];
}>();

const deckPreviewCards = ref<any[]>([]);
const deckPreviewLoading = ref(false);

const difficultyClass = computed(() => {
  return `difficulty-${props.storyMode.difficulty}`;
});

const difficultyLabel = computed(() => {
  const labels: Record<number, string> = {
    1: "Easy",
    2: "Normal",
    3: "Hard",
    4: "Expert",
    5: "Mythic",
  };
  return (
    labels[props.storyMode.difficulty] || `Level ${props.storyMode.difficulty}`
  );
});

const difficultyDescription = computed(() => {
  const descriptions: Record<number, string> = {
    1: "AI uses base card stats",
    2: "+1 to one side per card",
    3: "+2 across two sides total",
    4: "+3 total (one per side up to level)",
    5: "+4 total, optimized AI placement logic",
  };
  return descriptions[props.storyMode.difficulty] || "";
});

const isCompleted = computed(() => {
  return (props.storyMode.user_progress?.times_completed || 0) > 0;
});

const isNewlyUnlocked = computed(() => {
  return props.storyMode.is_unlocked && !props.storyMode.user_progress;
});

const previewCards = computed(() => {
  return deckPreviewCards.value.slice(0, 3);
});

const firstWinReward = computed(() => {
  return props.storyMode.rewards.find((r) => r.reward_type === "first_win");
});

onMounted(() => {
  loadDeckPreview();
});

async function loadDeckPreview() {
  if (!props.storyMode.ai_deck_id) return;

  deckPreviewLoading.value = true;
  try {
    const deckData = await StoryModeService.getDeckPreview(
      props.storyMode.ai_deck_id
    );
    if (deckData?.cards || deckData?.deck_cards) {
      // Adjust based on your deck data structure
      deckPreviewCards.value = (
        deckData.cards ||
        deckData.deck_cards ||
        []
      ).slice(0, 3);
    }
  } catch (error) {
    console.warn("Failed to load deck preview:", error);
  } finally {
    deckPreviewLoading.value = false;
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function handleClick() {
  if (props.storyMode.can_play) {
    emit("select", props.storyMode);
  }
}
</script>

<style scoped lang="scss">
.story-mode-card {
  background: var(--card-bg);
  border: 2px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;

  &:hover:not(.locked) {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    border-color: var(--primary-color);
  }

  &.locked {
    opacity: 0.7;
    cursor: not-allowed;
  }

  &.completed {
    border-color: var(--success-color);
  }

  &.new {
    border-color: var(--accent-color);
    animation: pulse 2s infinite;
  }
}

.lock-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  z-index: 10;
  color: white;
  font-weight: bold;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.difficulty-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: bold;
  text-transform: uppercase;

  &.difficulty-1 {
    background: var(--success-color);
    color: white;
  }

  &.difficulty-2 {
    background: var(--info-color, #3b82f6);
    color: white;
  }

  &.difficulty-3 {
    background: var(--warning-color);
    color: white;
  }

  &.difficulty-4 {
    background: var(--danger-color);
    color: white;
  }

  &.difficulty-5 {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }
}

.completed-badge {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--success-color);
  font-size: 0.875rem;
}

.card-content {
  .story-name {
    font-size: 1.25rem;
    font-weight: bold;
    margin-bottom: 0.5rem;
  }

  .story-description {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 1rem;
    line-height: 1.5;
  }
}

.deck-preview {
  margin: 1rem 0;

  h4 {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
  }

  .deck-cards {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .more-cards {
    padding: 0.5rem;
    background: var(--bg-secondary);
    border-radius: 8px;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .deck-placeholder {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border-radius: 8px;
    color: var(--text-secondary);
  }

  .deck-loading {
    display: flex;
    justify-content: center;
    padding: 1rem;
  }
}

.progress-info {
  display: flex;
  gap: 1rem;
  margin: 1rem 0;
  padding: 0.75rem;
  background: var(--bg-secondary);
  border-radius: 8px;

  .progress-stat {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }
}

.rewards-preview {
  margin: 1rem 0;

  h4 {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
  }

  .rewards-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .reward-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: var(--bg-secondary);
    border-radius: 6px;
    font-size: 0.75rem;
  }
}

.unlock-requirements {
  margin-top: 1rem;
  padding: 0.75rem;
  background: var(--warning-bg);
  border-radius: 8px;

  h4 {
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;

    li {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-bottom: 0.25rem;

      &:before {
        content: "• ";
        color: var(--warning-color);
        font-weight: bold;
      }
    }
  }
}

.card-footer {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.play-button {
  width: 100%;
  padding: 0.75rem;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.2s;

  &:hover:not(.disabled) {
    background: var(--primary-hover);
    transform: scale(1.02);
  }

  &.disabled {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: not-allowed;
  }
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--accent-color-rgb), 0.7);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(var(--accent-color-rgb), 0);
  }
}
</style>
```

---

## Navigation Flow

### Update Home Screen

Modify your home screen component to navigate to story mode list:

```typescript
// In your HomeScreen.vue or similar component

function handleSoloPlay() {
  router.push({ name: "StoryModeList" });
}

function handleOnlinePlay() {
  // Existing online play logic
}
```

### Router Configuration

Add route to your router configuration:

```typescript
// router/index.ts

import StoryModeListView from "@/views/StoryModeListView.vue";

const routes = [
  // ... existing routes
  {
    path: "/story-modes",
    name: "StoryModeList",
    component: StoryModeListView,
    meta: {
      requiresAuth: true,
    },
  },
  // ... other routes
];
```

---

## State Management

### Pinia Store (if using Pinia)

Create `src/stores/storyMode.ts`:

```typescript
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { StoryModeService } from "@/services/storyMode.service";
import {
  StoryModeWithProgress,
  UserStoryProgress,
  ChapterGroup,
} from "@/types/storyMode.types";

export const useStoryModeStore = defineStore("storyMode", () => {
  const storyModes = ref<StoryModeWithProgress[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);

  const unlockedStoryModes = computed(() =>
    storyModes.value.filter((sm) => sm.is_unlocked)
  );

  const completedStoryModes = computed(() =>
    storyModes.value.filter(
      (sm) => (sm.user_progress?.times_completed || 0) > 0
    )
  );

  const totalWins = computed(() =>
    storyModes.value.reduce(
      (sum, sm) => sum + (sm.user_progress?.times_completed || 0),
      0
    )
  );

  // Group story modes by chapter
  const chaptersGrouped = computed((): ChapterGroup[] => {
    const groups = new Map<number, StoryModeWithProgress[]>();

    storyModes.value.forEach((sm) => {
      const chapterNum =
        sm.chapter_number || Math.floor(sm.order_index / 5) + 1;
      if (!groups.has(chapterNum)) {
        groups.set(chapterNum, []);
      }
      groups.get(chapterNum)!.push(sm);
    });

    // Convert to array and sort by chapter number
    return Array.from(groups.entries())
      .map(([chapterNum, difficulties]) => ({
        chapter_number: chapterNum,
        theme: difficulties[0]?.chapter_info?.theme || `Chapter ${chapterNum}`,
        boss_name: difficulties[0]?.chapter_info?.boss_name || "",
        difficulties: difficulties.sort((a, b) => a.difficulty - b.difficulty),
        is_mastered: difficulties.every(
          (d) => (d.user_progress?.times_completed || 0) > 0
        ),
        completion_count: difficulties.filter(
          (d) => (d.user_progress?.times_completed || 0) > 0
        ).length,
      }))
      .sort((a, b) => a.chapter_number - b.chapter_number);
  });

  async function fetchStoryModes() {
    loading.value = true;
    error.value = null;

    try {
      const response = await StoryModeService.getAvailableStoryModes();
      storyModes.value = response.story_modes;
      lastUpdated.value = new Date();
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function getStoryModeById(
    storyId: string
  ): StoryModeWithProgress | undefined {
    return storyModes.value.find((sm) => sm.story_id === storyId);
  }

  function updateStoryModeProgress(
    storyId: string,
    progress: UserStoryProgress
  ) {
    const storyMode = getStoryModeById(storyId);
    if (storyMode) {
      storyMode.user_progress = progress;
      storyMode.is_unlocked = true;
      storyMode.can_play = true;
    }
  }

  return {
    storyModes,
    loading,
    error,
    lastUpdated,
    unlockedStoryModes,
    completedStoryModes,
    totalWins,
    chaptersGrouped,
    fetchStoryModes,
    getStoryModeById,
    updateStoryModeProgress,
  };
});
```

---

## Integration with Game Flow

### Game Completion Handler

Update your game completion handler to process story mode rewards:

```typescript
// In your game completion handler or game store

import { StoryModeService } from "@/services/storyMode.service";
import { useStoryModeStore } from "@/stores/storyMode";

async function handleGameCompletion(gameResult: any, gameId: string) {
  const route = useRoute();
  const storyModeStore = useStoryModeStore();

  // Check if this was a story mode game
  if (route.query.mode === "story" && route.query.storyId) {
    const storyId = route.query.storyId as string;
    const startTime = gameResult.game_start_time; // Adjust based on your game result structure
    const completionTime = Math.floor((Date.now() - startTime) / 1000);

    try {
      const rewards = await StoryModeService.processStoryCompletion({
        story_id: storyId,
        game_result: gameResult,
        completion_time_seconds: completionTime,
      });

      // Update store
      if (rewards.new_progress) {
        storyModeStore.updateStoryModeProgress(storyId, rewards.new_progress);
      }

      // Show rewards modal
      showRewardsModal(rewards);

      // Show unlock notifications
      if (rewards.unlocked_stories?.length) {
        showUnlockNotification(rewards.unlocked_stories);
      }
    } catch (error) {
      console.error("Failed to process story completion:", error);
    }
  }

  // Continue with normal game completion flow
}
```

---

## Error Handling

### Global Error Handler

```typescript
// utils/errorHandler.ts

export function handleStoryModeError(error: any): string {
  if (error.response) {
    switch (error.response.status) {
      case 401:
        return "Please log in to access story modes";
      case 403:
        return "You do not meet the requirements for this story mode";
      case 404:
        return "Story mode not found";
      case 400:
        return error.response.data?.error || "Invalid request";
      default:
        return "An error occurred. Please try again.";
    }
  }
  return error.message || "An unexpected error occurred";
}
```

---

## UI/UX Considerations

### Visual Indicators

1. **Difficulty Colors** (Levels 1-5):

   - Level 1 (Easy): Green
   - Level 2 (Normal): Blue
   - Level 3 (Hard): Yellow/Orange
   - Level 4 (Expert): Red
   - Level 5 (Mythic): Purple/Gradient

2. **Chapter Organization**:

   - Group story modes by chapter (10 chapters total)
   - Display chapter theme and boss name
   - Show progress indicator for chapter completion (X/5 difficulties completed)
   - Highlight mastered chapters (all 5 difficulties completed)

3. **Lock States**:

   - Show lock icon overlay
   - Display unlock requirements clearly
   - Gray out locked difficulties
   - Indicate if previous difficulty in same chapter must be completed first

4. **Progress Indicators**:

   - Show completion badge for completed difficulties
   - Display win count and best time per difficulty
   - Highlight newly unlocked difficulties
   - Show chapter mastery badge when all 5 difficulties completed

5. **Deck Preview**:
   - Show 3 cards from AI deck
   - Display total card count if more than 3
   - Use your existing card preview component

### Loading States

- Show skeleton loaders while fetching story modes
- Display loading spinner for deck previews
- Provide retry options on errors

### Accessibility

- Ensure keyboard navigation works
- Add ARIA labels for screen readers
- Provide clear focus indicators
- Use semantic HTML elements

---

## Testing Checklist

### Functional Tests

- [ ] Story mode list loads correctly
- [ ] Deck previews display properly
- [ ] Locked story modes show requirements
- [ ] Unlocked story modes are playable
- [ ] Game starts correctly when selecting a story mode
- [ ] Progress updates after game completion
- [ ] Rewards are displayed correctly
- [ ] New unlocks are notified
- [ ] Error states are handled gracefully

### UI Tests

- [ ] Cards are responsive on mobile
- [ ] Loading states display properly
- [ ] Error messages are clear
- [ ] Navigation works correctly
- [ ] Visual indicators are clear

### Integration Tests

- [ ] Story mode integrates with existing game flow
- [ ] Deck selection works correctly
- [ ] Game completion triggers reward processing
- [ ] Store updates reflect changes

---

## Additional Notes

1. **API Base URL Configuration**:

   - If your `apiClient` is configured with a base URL that includes `/api` (e.g., `axios.create({ baseURL: 'http://localhost:3000/api' })`), then use `/story-modes` as the BASE_URL
   - If your `apiClient` doesn't have a base URL configured, use `/api/story-modes` as the BASE_URL
   - The current implementation assumes your apiClient already has `/api` in its base URL configuration

2. **Difficulty Levels**: The system now uses numeric difficulty levels (1-5) instead of string-based difficulties. Each level corresponds to the AI's card level and scaling behavior.

3. **Chapter Organization**: Consider implementing a chapter-based view that groups the 50 story mode entries (10 chapters × 5 difficulties) for better UX. The `chaptersGrouped` computed property in the store provides this grouping.

4. **Deck Preview API**: You may need to create or use an existing endpoint to fetch deck cards. Adjust the `getDeckPreview` method accordingly. Note that each difficulty level uses different card instances (L1-L5) from the same base deck.

5. **Card Component**: Replace `CardPreview` with your existing card preview component.

6. **Icon Component**: Replace `Icon` with your existing icon component or use a library like `vue-feather-icons`.

7. **API Client**: Adjust the `apiClient` import to match your existing API client setup.

8. **Styling**: Update CSS variables (`--primary-color`, `--text-secondary`, etc.) to match your design system. Difficulty classes now use numeric suffixes (`.difficulty-1` through `.difficulty-5`).

9. **Store**: If you're not using Pinia, adapt the store example to your state management solution (Vuex, composables, etc.).

10. **Chapter Metadata**: The API may return chapter information (`chapter_number`, `theme`, `boss_name`) with each story mode entry. If not, you can derive chapter numbers from `order_index` (chapter = Math.floor(order_index / 5) + 1).

---

## Next Steps

1. Copy the TypeScript types into your project
2. Create the API service layer
3. Build the Vue components
4. Update routing configuration
5. Integrate with existing game flow
6. Test thoroughly
7. Polish UI/UX based on your design system

This implementation provides a complete foundation for the story mode feature in your Vue.js client application.
