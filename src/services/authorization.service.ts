/**
 * =============================================================================
 * AuthorizationService — Minimal Role Management
 * =============================================================================
 * Purpose
 *  - Provide only the essential operations around `AuthorizationModel`:
 *    get, set (create-or-update), update (must exist), and delete.
 *  - Returns **plain entities**; controllers handle any `{ data: ... }` wrapping.
 *
 * Design Notes
 *  - ESM-ready (NodeNext). Use `.js` in local import paths.
 *  - Write paths run inside MySQL transactions; row locks protect updates.
 *  - Throws domain errors from `src/errors/*` for consistent HTTP mapping.
 * =============================================================================
 */

import { Transaction } from 'sequelize';
import { sequelize } from '../db/sequelize.js';
import {
  AuthorizationModel,
  type Role,
} from '../models/authorization.model.js';
import { UserModel } from '../models/user.model.js';
import { NotFoundError } from '../errors/index.js';

/** Run a function inside a transaction with auto-commit/rollback. */
async function withTransaction<T>(
  work: (t: Transaction) => Promise<T>
): Promise<T> {
  return sequelize.transaction((t) => work(t));
}

export class AuthorizationService {
  /**
   * Get the authorization for a given user.
   *
   * @param {string} userId - The user's UUID (PK of the authorization row).
   * @returns {Promise<Record<string, unknown>>} Plain authorization object.
   * @throws {NotFoundError} If no authorization exists for this user.
   */
  static async get(userId: string) {
    const auth = await AuthorizationModel.findByPk(userId);
    if (!auth) throw new NotFoundError('Authorization not found');
    return auth.toJSON();
  }

  /**
   * Set the role for a user (create-or-update, idempotent).
   * - Creates the authorization if it doesn't exist.
   * - Updates the existing role if it does.
   *
   * @param {string} userId - The user's UUID.
   * @param {Role} role - One of: 'user' | 'employee' | 'administrator'.
   * @returns {Promise<Record<string, unknown>>} Upserted authorization object.
   * @throws {NotFoundError} If the referenced user does not exist.
   */
  static async set(userId: string, role: Role) {
    return withTransaction(async (t) => {
      // Ensure the user exists (nicer error than raw FK failure)
      const user = await UserModel.findByPk(userId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!user) throw new NotFoundError('User not found');

      const existing = await AuthorizationModel.findByPk(userId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (existing) {
        existing.role = role;
        await existing.save({ transaction: t });
        return existing.toJSON();
      }

      const created = await AuthorizationModel.create(
        { userId, role },
        { transaction: t }
      );
      return created.toJSON();
    });
  }

  /**
   * Update an existing authorization (role only).
   * - Fails if the authorization does not exist.
   *
   * @param {string} userId - The user's UUID.
   * @param {{ role?: Role }} updates - Partial payload; only `role` is supported.
   * @returns {Promise<Record<string, unknown>>} Updated authorization object.
   * @throws {NotFoundError} If the authorization does not exist.
   */
  static async update(userId: string, updates: { role?: Role }) {
    return withTransaction(async (t) => {
      const auth = await AuthorizationModel.findByPk(userId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!auth) throw new NotFoundError('Authorization not found');

      if (updates.role !== undefined) auth.role = updates.role;
      await auth.save({ transaction: t });
      return auth.toJSON();
    });
  }

  /**
   * Delete a user's authorization.
   *
   * @param {string} userId - The user's UUID.
   * @returns {Promise<{ success: true }>}
   * @throws {NotFoundError} If the authorization does not exist.
   */
  static async delete(userId: string) {
    return withTransaction(async (t) => {
      const n = await AuthorizationModel.destroy({
        where: { userId },
        transaction: t,
      });
      if (!n) throw new NotFoundError('Authorization not found');
      return { success: true };
    });
  }
}

export const authorizationService = AuthorizationService;
