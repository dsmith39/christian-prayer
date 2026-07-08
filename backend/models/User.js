/**
 * models/User.js
 * ---------------
 * DynamoDB data-access layer for FaithRequest users.
 *
 * Storage model (table: DYNAMODB_TABLE_NAME) mirrors the previous embedded
 * Mongoose document almost exactly — one item holds the user's full profile
 * plus their entire prayerLists[] -> prayers[] tree as a nested attribute:
 *
 *   Profile item : pk="USER#<uuid>"   sk="PROFILE"
 *                  { userId, name, email, passwordHash, prayerLists, createdAt, updatedAt }
 *   Email lock   : pk="EMAIL#<email>" sk="PROFILE"
 *                  { userId }
 *
 * The email-lock item exists so registration can enforce a unique email with
 * a single atomic TransactWriteItems call (both items are created/deleted
 * together), and so login can look up a user by email with a direct key
 * GetItem instead of a secondary index.
 */
const {
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require("uuid");
const { ddb, TABLE_NAME } = require("../config/dynamo");

const userKey = (userId) => ({ pk: `USER#${userId}`, sk: "PROFILE" });
const emailKey = (email) => ({ pk: `EMAIL#${email}`, sk: "PROFILE" });

/**
 * Shapes a raw DynamoDB profile item into the object shape the routes
 * expect (mirrors the fields a Mongoose User document exposed).
 *
 * @param {object|undefined} item
 * @returns {object|null}
 */
function toUser(item) {
  if (!item) {
    return null;
  }

  return {
    _id: item.userId,
    name: item.name,
    email: item.email,
    passwordHash: item.passwordHash,
    prayerLists: item.prayerLists || [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Creates a new user. Throws an error with code "DUPLICATE_EMAIL" if the
 * email is already registered — the email-lock item's conditional put fails
 * the whole transaction atomically, so this is race-safe under concurrent
 * registrations for the same address.
 *
 * @param {{ name: string, email: string, passwordHash: string, prayerLists: object[] }} input
 * @returns {Promise<object>}
 */
async function createUser({ name, email, passwordHash, prayerLists }) {
  const userId = uuidv4();
  const now = new Date().toISOString();

  const profileItem = {
    ...userKey(userId),
    userId,
    name,
    email,
    passwordHash,
    prayerLists,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE_NAME,
              Item: { ...emailKey(email), userId },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: profileItem,
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
        ],
      })
    );
  } catch (error) {
    if (error.name === "TransactionCanceledException") {
      const duplicate = new Error("A user with this email already exists");
      duplicate.code = "DUPLICATE_EMAIL";
      throw duplicate;
    }
    throw error;
  }

  return toUser(profileItem);
}

/**
 * Looks up a user by email via the email-lock item.
 *
 * @param {string} email
 * @returns {Promise<object|null>}
 */
async function findByEmail(email) {
  const lock = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: emailKey(email) })
  );

  if (!lock.Item) {
    return null;
  }

  return findById(lock.Item.userId);
}

/**
 * Looks up a user by ID.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function findById(userId) {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: userKey(userId) })
  );

  return toUser(result.Item);
}

/**
 * Persists prayerLists (and bumps updatedAt) for an existing user. Mirrors
 * the previous `user.save()` call after mutating prayerLists in place.
 *
 * @param {string} userId
 * @param {{ prayerLists: object[] }} updates
 */
async function updateUser(userId, { prayerLists }) {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: userKey(userId),
      UpdateExpression: "SET prayerLists = :prayerLists, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":prayerLists": prayerLists,
        ":updatedAt": new Date().toISOString(),
      },
    })
  );
}

/**
 * Deletes a user and its email-lock item together.
 *
 * @param {string} userId
 * @returns {Promise<boolean>} false if the user didn't exist.
 */
async function deleteUser(userId) {
  const user = await findById(userId);
  if (!user) {
    return false;
  }

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE_NAME, Key: userKey(userId) } },
        { Delete: { TableName: TABLE_NAME, Key: emailKey(user.email) } },
      ],
    })
  );

  return true;
}

module.exports = {
  createUser,
  findByEmail,
  findById,
  updateUser,
  deleteUser,
};
