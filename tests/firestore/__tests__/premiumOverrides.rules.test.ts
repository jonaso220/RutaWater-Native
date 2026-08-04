import fs from 'fs';
import path from 'path';
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import 'firebase/compat/firestore';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulator ? describe : describe.skip;

describeWithEmulator('premium override Firestore rules', () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, rawPort] = (emulator || '127.0.0.1:8080').split(':');
    testEnvironment = await initializeTestEnvironment({
      projectId: 'demo-rutawater',
      firestore: {
        host,
        port: Number(rawPort),
        rules: fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnvironment.clearFirestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('premiumOverrides/owner').set({
        active: true,
        type: 'lifetime',
        userId: 'owner',
        legacy: 'preserve',
      });
      await context.firestore().doc('premiumOverrides/inactive').set({
        active: false,
        type: 'lifetime',
        userId: 'inactive',
      });
      await context.firestore().doc('promoCodes/private-code').set({
        active: true,
        maxUses: 1,
      });
    });
  });

  afterAll(async () => {
    await testEnvironment.cleanup();
  });

  test('allows users to read only their own Premium', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const strangerDb = testEnvironment.authenticatedContext('stranger').firestore();
    await assertSucceeds(ownerDb.doc('premiumOverrides/owner').get());
    await assertFails(strangerDb.doc('premiumOverrides/owner').get());
  });

  test('denies client-side grants and reactivation', async () => {
    const ownerDb = testEnvironment.authenticatedContext('new-owner').firestore();
    const inactiveDb = testEnvironment.authenticatedContext('inactive').firestore();
    await assertFails(ownerDb.doc('premiumOverrides/new-owner').set({
      active: true,
      type: 'lifetime',
    }));
    await assertFails(inactiveDb.doc('premiumOverrides/inactive').update({ active: true }));
  });

  test('allows only the legacy-compatible true to false transition', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const ownRef = ownerDb.doc('premiumOverrides/owner');
    await assertSucceeds(ownRef.update({ active: false }));

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('premiumOverrides/owner').update({ active: true });
    });
    await assertFails(ownRef.update({ active: false, type: 'monthly' }));
  });

  test('allows deleting only the own override', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const strangerDb = testEnvironment.authenticatedContext('stranger').firestore();
    await assertFails(strangerDb.doc('premiumOverrides/owner').delete());
    await assertSucceeds(ownerDb.doc('premiumOverrides/owner').delete());
  });

  test('keeps promo code documents private', async () => {
    const ownerDb = testEnvironment.authenticatedContext('owner').firestore();
    const promoRef = ownerDb.doc('promoCodes/private-code');
    await assertFails(promoRef.get());
    await assertFails(ownerDb.doc('promoCodes/another-code').set({ active: true }));
    await assertFails(promoRef.update({ usedCount: 1 }));
    await assertFails(promoRef.delete());
  });
});
