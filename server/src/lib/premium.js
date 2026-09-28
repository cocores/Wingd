import db from '../firestore.js';

const FREE_CIRCLE_SIZE = 5;
const PREMIUM_CIRCLE_SIZE = 15;
const FREE_DAILY_LIKES = 10;

export async function isPremium(userId) {
  const doc = await db.collection('users').doc(userId).get();
  return doc.data()?.premiumStatus === 'active';
}

export async function getCircleCap(userId) {
  return (await isPremium(userId)) ? PREMIUM_CIRCLE_SIZE : FREE_CIRCLE_SIZE;
}

export async function getDailyLikeCap(userId) {
  return (await isPremium(userId)) ? Infinity : FREE_DAILY_LIKES;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

function likeCountDocId(userId, dateKey) {
  return `${userId}__${dateKey}`;
}

export async function getTodayLikeCount(userId) {
  const doc = await db.collection('dailyLikeCounts').doc(likeCountDocId(userId, todayKey())).get();
  return doc.exists ? doc.data().count : 0;
}

// Atomically checks the day's like count against the cap and increments it,
// so two concurrent likes can't both slip in under the cap.
export async function tryConsumeDailyLike(userId) {
  const cap = await getDailyLikeCap(userId);
  if (cap === Infinity) return true;

  const ref = db.collection('dailyLikeCounts').doc(likeCountDocId(userId, todayKey()));
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const count = doc.exists ? doc.data().count : 0;
    if (count >= cap) return false;
    tx.set(ref, { userId, date: todayKey(), count: count + 1 }, { merge: true });
    return true;
  });
}

export { FREE_CIRCLE_SIZE, PREMIUM_CIRCLE_SIZE, FREE_DAILY_LIKES };
