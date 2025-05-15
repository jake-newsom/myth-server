// Type declarations for Socket.IO authentication
import { Socket } from "socket.io";

export interface User {
  user_id: string;
  username: string;
  email: string;
  in_game_currency: number;
}

export interface AuthenticatedSocket extends Socket {
  user: User;
}

export interface JwtPayload {
  userId: string;
}
