import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { listQuerySchema } from "./schema.js";
import { getUnreadCount, listForUser, markAllRead, markRead } from "./service.js";

export const notificationsRouter = Router();

/** GET /notifications?unreadOnly=true */
notificationsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const { unreadOnly } = listQuerySchema.parse(req.query);
    const user = req.user!;
    const [items, unreadCount] = await Promise.all([
      listForUser(user, { unreadOnly }),
      getUnreadCount(user),
    ]);
    res.json({ data: { items, unreadCount } });
  } catch (err) {
    next(err);
  }
});

/** PATCH /notifications/:id/read */
notificationsRouter.patch("/:id/read", requireAuth, async (req, res, next) => {
  try {
    const user = req.user!;
    const result = await markRead(req.params.id as string, user);
    if (!result) {
      res.status(404).json({ error: { code: "not_found", message: "Notification not found" } });
      return;
    }
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/** PATCH /notifications/read-all */
notificationsRouter.patch("/read-all", requireAuth, async (req, res, next) => {
  try {
    const user = req.user!;
    const result = await markAllRead(user);
    res.json({ data: { count: result.count } });
  } catch (err) {
    next(err);
  }
});
