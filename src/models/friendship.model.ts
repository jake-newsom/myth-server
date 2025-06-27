import db from "../config/db.config";
import { Friendship, FriendshipWithUser } from "../types/database.types";

const FriendshipModel = {
  /**
   * Send a friend request between two users
   */
  async sendFriendRequest(
    requesterId: string,
    addresseeId: string
  ): Promise<Friendship> {
    const query = `
      INSERT INTO friendships (requester_id, addressee_id, status)
      VALUES ($1, $2, 'pending')
      RETURNING id, requester_id, addressee_id, status, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [requesterId, addresseeId]);
    return rows[0];
  },

  /**
   * Get friendship by ID
   */
  async findById(friendshipId: string): Promise<Friendship | null> {
    const query = `
      SELECT id, requester_id, addressee_id, status, created_at, updated_at
      FROM friendships 
      WHERE id = $1;
    `;
    const { rows } = await db.query(query, [friendshipId]);
    return rows[0] || null;
  },

  /**
   * Find friendship between two users (bidirectional search)
   */
  async findFriendshipBetweenUsers(
    userId1: string,
    userId2: string
  ): Promise<Friendship | null> {
    const query = `
      SELECT id, requester_id, addressee_id, status, created_at, updated_at
      FROM friendships 
      WHERE (requester_id = $1 AND addressee_id = $2) 
         OR (requester_id = $2 AND addressee_id = $1);
    `;
    const { rows } = await db.query(query, [userId1, userId2]);
    return rows[0] || null;
  },

  /**
   * Accept a friend request
   */
  async acceptFriendRequest(friendshipId: string): Promise<Friendship | null> {
    const query = `
      UPDATE friendships 
      SET status = 'accepted', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, requester_id, addressee_id, status, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [friendshipId]);
    return rows[0] || null;
  },

  /**
   * Reject a friend request
   */
  async rejectFriendRequest(friendshipId: string): Promise<Friendship | null> {
    const query = `
      UPDATE friendships 
      SET status = 'rejected', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, requester_id, addressee_id, status, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [friendshipId]);
    return rows[0] || null;
  },

  /**
   * Block a user (can be done from any friendship state)
   */
  async blockUser(friendshipId: string): Promise<Friendship | null> {
    const query = `
      UPDATE friendships 
      SET status = 'blocked', updated_at = NOW()
      WHERE id = $1
      RETURNING id, requester_id, addressee_id, status, created_at, updated_at;
    `;
    const { rows } = await db.query(query, [friendshipId]);
    return rows[0] || null;
  },

  /**
   * Remove a friendship (delete the record entirely)
   */
  async removeFriendship(friendshipId: string): Promise<boolean> {
    const query = `DELETE FROM friendships WHERE id = $1;`;
    const result = await db.query(query, [friendshipId]);
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Get all friends for a user (accepted friendships only)
   */
  async getFriends(userId: string): Promise<FriendshipWithUser[]> {
    const query = `
      SELECT 
        f.id,
        f.requester_id,
        f.addressee_id,
        f.status,
        f.created_at,
        f.updated_at,
        CASE 
          WHEN f.requester_id = $1 THEN u2.username
          ELSE u1.username
        END as friend_username,
        CASE 
          WHEN f.requester_id = $1 THEN u2.email
          ELSE u1.email
        END as friend_email
      FROM friendships f
      JOIN users u1 ON f.requester_id = u1.user_id
      JOIN users u2 ON f.addressee_id = u2.user_id
      WHERE (f.requester_id = $1 OR f.addressee_id = $1) 
        AND f.status = 'accepted'
      ORDER BY f.updated_at DESC;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
  },

  /**
   * Get pending friend requests sent TO the user (incoming requests)
   */
  async getIncomingFriendRequests(
    userId: string
  ): Promise<FriendshipWithUser[]> {
    const query = `
      SELECT 
        f.id,
        f.requester_id,
        f.addressee_id,
        f.status,
        f.created_at,
        f.updated_at,
        u1.username as friend_username,
        u1.email as friend_email
      FROM friendships f
      JOIN users u1 ON f.requester_id = u1.user_id
      WHERE f.addressee_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
  },

  /**
   * Get pending friend requests sent BY the user (outgoing requests)
   */
  async getOutgoingFriendRequests(
    userId: string
  ): Promise<FriendshipWithUser[]> {
    const query = `
      SELECT 
        f.id,
        f.requester_id,
        f.addressee_id,
        f.status,
        f.created_at,
        f.updated_at,
        u2.username as friend_username,
        u2.email as friend_email
      FROM friendships f
      JOIN users u2 ON f.addressee_id = u2.user_id
      WHERE f.requester_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows;
  },

  /**
   * Get all friend requests (both incoming and outgoing) for a user
   */
  async getAllFriendRequests(userId: string): Promise<{
    incoming: FriendshipWithUser[];
    outgoing: FriendshipWithUser[];
  }> {
    const [incoming, outgoing] = await Promise.all([
      this.getIncomingFriendRequests(userId),
      this.getOutgoingFriendRequests(userId),
    ]);

    return { incoming, outgoing };
  },

  /**
   * Search for users by username (for adding friends)
   * Excludes users who are already friends or have pending requests
   */
  async searchUsersForFriending(
    searcherId: string,
    searchTerm: string,
    limit: number = 20
  ): Promise<Array<{ user_id: string; username: string; email: string }>> {
    const query = `
      SELECT u.user_id, u.username, u.email
      FROM users u
      WHERE u.user_id != $1
        AND LOWER(u.username) LIKE LOWER($2)
        AND NOT EXISTS (
          SELECT 1 FROM friendships f
          WHERE (f.requester_id = $1 AND f.addressee_id = u.user_id)
             OR (f.requester_id = u.user_id AND f.addressee_id = $1)
        )
      ORDER BY u.username
      LIMIT $3;
    `;
    const { rows } = await db.query(query, [
      searcherId,
      `%${searchTerm}%`,
      limit,
    ]);
    return rows;
  },

  /**
   * Get friendship statistics for a user
   */
  async getFriendshipStats(userId: string): Promise<{
    friends_count: number;
    pending_incoming: number;
    pending_outgoing: number;
    blocked_count: number;
  }> {
    const query = `
      SELECT 
        COUNT(CASE WHEN status = 'accepted' THEN 1 END) as friends_count,
        COUNT(CASE WHEN status = 'pending' AND addressee_id = $1 THEN 1 END) as pending_incoming,
        COUNT(CASE WHEN status = 'pending' AND requester_id = $1 THEN 1 END) as pending_outgoing,
        COUNT(CASE WHEN status = 'blocked' THEN 1 END) as blocked_count
      FROM friendships
      WHERE requester_id = $1 OR addressee_id = $1;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows[0];
  },

  /**
   * Check if two users are friends
   */
  async areFriends(userId1: string, userId2: string): Promise<boolean> {
    const friendship = await this.findFriendshipBetweenUsers(userId1, userId2);
    return friendship?.status === "accepted";
  },

  /**
   * Check if a friend request already exists between two users
   */
  async hasExistingRequest(userId1: string, userId2: string): Promise<boolean> {
    const friendship = await this.findFriendshipBetweenUsers(userId1, userId2);
    return friendship !== null;
  },
};

export default FriendshipModel;
