import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiRequire = createRequire(path.join(__dirname, '../api/package.json'));
const dotenv = apiRequire('dotenv');

dotenv.config({ path: path.join(__dirname, '../api/.env') });

const RAW_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5001';
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, '');
const API_PREFIX = BASE_URL.endsWith('/api') ? '' : (process.env.API_PREFIX || '/api');
const PASSWORD = 'Password123!';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path, options = {}) {
  const url = `${BASE_URL}${API_PREFIX}${path}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    json = null;
  }
  if (!res.ok) {
    const message = json?.error || text || `Request failed: ${res.status}`;
    throw new Error(`${res.status} ${url}: ${message}`);
  }
  return json;
}

function getArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.notifications)) return payload.notifications;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function getValue(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return undefined;
}

function getNotificationType(notification) {
  return getValue(notification, ['type']);
}

function getNotificationActorId(notification) {
  return getValue(notification, ['actorId', 'actor_id'])
    ?? getValue(notification?.actor, ['id', 'userId'])
    ?? null;
}

function getNotificationEntityId(notification) {
  return getValue(notification, ['entityId', 'entity_id'])
    ?? getValue(notification?.entity, ['id', 'eventId', 'friendshipId'])
    ?? null;
}

function getNotificationId(notification) {
  return getValue(notification, ['id', 'notificationId', 'notification_id']);
}

function getNotificationIsRead(notification) {
  return getValue(notification, ['is_read', 'isRead']);
}

async function registerUser(label) {
  const username = `${label}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const email = `${username}@example.com`;
  await requestJson('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password: PASSWORD }),
  });
  return { username, password: PASSWORD };
}

async function loginUser({ username, password }) {
  const payload = await requestJson('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert(payload?.token, 'Login response missing token');
  assert(payload?.user?.id, 'Login response missing user id');
  return { token: payload.token, id: payload.user.id };
}

async function fetchNotifications(token) {
  const payload = await requestJson('/notifications?limit=100&offset=0', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return getArrayPayload(payload);
}

async function getUnreadCount(token) {
  const payload = await requestJson('/notifications/unread-count', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const count = getValue(payload, ['unreadCount', 'count']);
  if (count === undefined) return null;
  return Number(count);
}

function filterNotifications(notifications, criteria) {
  const { type, actorId, entityId } = criteria;
  const actor = actorId ? String(actorId) : null;
  const entity = entityId ? String(entityId) : null;
  return notifications.filter((notification) => {
    const nType = getNotificationType(notification);
    const nActor = getNotificationActorId(notification);
    const nEntity = getNotificationEntityId(notification);
    const matchesType = type ? nType === type : true;
    const matchesActor = actor ? String(nActor) === actor : true;
    const matchesEntity = entity ? String(nEntity) === entity : true;
    return matchesType && matchesActor && matchesEntity;
  });
}

async function expectSingleNotification(token, criteria) {
  const notifications = await fetchNotifications(token);
  const matches = filterNotifications(notifications, criteria);
  assert(matches.length === 1, `Expected 1 notification, found ${matches.length} (${criteria.type})`);
  return matches[0];
}

async function expectNoNotification(token, criteria) {
  const notifications = await fetchNotifications(token);
  const matches = filterNotifications(notifications, criteria);
  assert(matches.length === 0, `Expected 0 notifications, found ${matches.length} (${criteria.type})`);
}

async function sendFriendRequest(token, targetUserId) {
  const payload = await requestJson('/friends/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ targetUserId }),
  });
  const friendshipId = payload?.friendship?.id;
  assert(friendshipId, 'Friend request response missing friendship id');
  return friendshipId;
}

async function respondFriendRequest(token, friendshipId, action) {
  return requestJson('/friends/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ friendshipId, action }),
  });
}

async function findCollectableId(token) {
  const payload = await requestJson('/collectables?limit=1&offset=0', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const results = getArrayPayload(payload);
  assert(results.length > 0, 'No collectables available for check-in');
  const id = results[0]?.id;
  assert(id, 'Collectable response missing id');
  return id;
}

async function createCheckin(token, collectableId) {
  const payload = await requestJson('/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      collectableId,
      status: 'starting',
      visibility: 'public',
      note: 'Notification test check-in',
    }),
  });
  const eventId = payload?.event?.id;
  assert(eventId, 'Check-in response missing event id');
  return eventId;
}

async function toggleLike(token, eventId) {
  return requestJson(`/feed/${eventId}/like`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function addComment(token, eventId, content) {
  return requestJson(`/feed/${eventId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
}

async function markRead(token, notificationIds) {
  if (!notificationIds.length) return;
  return requestJson('/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ notificationIds }),
  });
}

async function run() {
  console.log(`Running notification API verification against ${BASE_URL}${API_PREFIX}`);

  const userA = await registerUser('notif_user_a');
  const userB = await registerUser('notif_user_b');

  const sessionA = await loginUser(userA);
  const sessionB = await loginUser(userB);

  const collectableId = await findCollectableId(sessionA.token);
  const eventId = await createCheckin(sessionA.token, collectableId);

  const friendshipId = await sendFriendRequest(sessionB.token, sessionA.id);
  await sendFriendRequest(sessionB.token, sessionA.id);

  await expectSingleNotification(sessionA.token, {
    type: 'friend_request',
    actorId: sessionB.id,
    entityId: friendshipId,
  });

  await toggleLike(sessionB.token, eventId);
  await expectSingleNotification(sessionA.token, {
    type: 'like',
    actorId: sessionB.id,
    entityId: eventId,
  });

  await toggleLike(sessionB.token, eventId);
  await expectNoNotification(sessionA.token, {
    type: 'like',
    actorId: sessionB.id,
    entityId: eventId,
  });

  await toggleLike(sessionB.token, eventId);
  await expectSingleNotification(sessionA.token, {
    type: 'like',
    actorId: sessionB.id,
    entityId: eventId,
  });

  await addComment(sessionB.token, eventId, 'Notification test comment');
  await expectSingleNotification(sessionA.token, {
    type: 'comment',
    actorId: sessionB.id,
    entityId: eventId,
  });

  await respondFriendRequest(sessionA.token, friendshipId, 'accept');
  await expectSingleNotification(sessionB.token, {
    type: 'friend_accept',
    actorId: sessionA.id,
    entityId: friendshipId,
  });

  const notifications = await fetchNotifications(sessionA.token);
  const toMark = [
    ...filterNotifications(notifications, { type: 'friend_request', actorId: sessionB.id, entityId: friendshipId }),
    ...filterNotifications(notifications, { type: 'like', actorId: sessionB.id, entityId: eventId }),
    ...filterNotifications(notifications, { type: 'comment', actorId: sessionB.id, entityId: eventId }),
  ]
    .map(getNotificationId)
    .filter(Boolean);

  await markRead(sessionA.token, toMark);
  const afterMark = await fetchNotifications(sessionA.token);
  for (const id of toMark) {
    const match = afterMark.find((item) => String(getNotificationId(item)) === String(id));
    if (!match) continue;
    const readFlag = getNotificationIsRead(match);
    if (readFlag !== undefined) {
      assert(readFlag === true, `Expected notification ${id} to be marked read`);
    }
  }

  const unreadCount = await getUnreadCount(sessionA.token);
  if (unreadCount !== null) {
    console.log(`Unread count (User A): ${unreadCount}`);
  }

  console.log('Notification API verification complete.');
}

run().catch((err) => {
  console.error('Notification API verification failed:', err.message);
  process.exitCode = 1;
});
