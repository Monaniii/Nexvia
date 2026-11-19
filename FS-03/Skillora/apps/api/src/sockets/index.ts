import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env, corsOrigins } from '../config/env';
import { verifyAccessToken } from '../lib/tokens';
import { User } from '../models/identity';
import { logger } from '../lib/logger';
import { getChatHistory, saveChatMessage, heartbeat, leaveRoom, issueRoomToken } from '../services/live.service';
import { LiveClass } from '../models/live';

interface SocketUser {
  id: string;
  role: string;
  name: string;
}

declare module 'socket.io' {
  interface Socket {
    user?: SocketUser;
  }
}

/**
 * Socket.IO layer.
 *
 * Authentication happens on the handshake using the same short-lived access
 * token as the REST API; every room join re-checks authorization server-side.
 * Chat messages are persisted before they are broadcast.
 */
export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    path: '/api/v1/socket.io',
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub).select('name role isActive').lean();
      if (!user || !user.isActive) return next(new Error('unauthorized'));
      socket.user = { id: String(user._id), role: user.role, name: user.name };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user!;
    socket.join(`user:${user.id}`);

    /** Join a live class room after verifying enrollment / ownership. */
    socket.on('live:join', async (liveClassId: string, ack?: (r: unknown) => void) => {
      try {
        const result = await issueRoomToken(liveClassId, {
          id: user.id,
          role: user.role as never,
          name: user.name,
        });
        socket.join(`live:${liveClassId}`);
        const history = await getChatHistory(liveClassId, {
          id: user.id,
          role: user.role as never,
        });
        ack?.({ ok: true, chat: history, room: result });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'join failed' });
      }
    });

    socket.on('live:leave', async (liveClassId: string) => {
      socket.leave(`live:${liveClassId}`);
      await leaveRoom(liveClassId, user.id).catch(() => undefined);
    });

    socket.on(
      'live:message',
      async (payload: { liveClassId: string; message: string }, ack?: (r: unknown) => void) => {
        try {
          if (!payload?.liveClassId || !payload?.message?.trim()) throw new Error('Invalid message');
          const saved = await saveChatMessage(
            payload.liveClassId,
            { id: user.id, role: user.role as never, name: user.name },
            payload.message.trim(),
          );
          io.to(`live:${payload.liveClassId}`).emit('live:message', saved);
          ack?.({ ok: true, message: saved });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : 'send failed' });
        }
      },
    );

    socket.on('live:heartbeat', async (liveClassId: string) => {
      await heartbeat(liveClassId, user.id).catch(() => undefined);
    });

    socket.on('live:typing', (liveClassId: string) => {
      socket.to(`live:${liveClassId}`).emit('live:typing', { userId: user.id, name: user.name });
    });

    socket.on('disconnect', async () => {
      // Close out any live rooms the socket was occupying.
      const rooms = [...socket.rooms].filter((r) => r.startsWith('live:'));
      for (const room of rooms) {
        const liveClassId = room.slice(5);
        socket.to(room).emit('live:participant_left', { userId: user.id, name: user.name });
        await leaveRoom(liveClassId, user.id).catch(() => undefined);
      }
    });
  });

  /** Server-side push helper (reminders, moderation events, etc.). */
  const notify = (userId: string, event: string, payload: unknown) => {
    io.to(`user:${userId}`).emit(event, payload);
  };

  logger.info('Socket.IO initialized');
  return { io, notify };
}

export type SocketServer = ReturnType<typeof createSocketServer>;
export { env, LiveClass };