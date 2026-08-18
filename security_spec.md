# Firebase Security Spec

## 1. Data Invariants
1. **Users**: User documents can only be read by authenticated users, and updated only by admins or the owner (for non-role fields).
2. **Lines**: Lines are system configurations, readable by all authenticated users, writable only by admins (coordinators).
3. **OPs (Production Orders)**: OPs represent active work. Readable by all authenticated users, but writable/updateable only by coordinators. Leaders can update specific state fields (status, producedQuantity) via specific actions.
4. **Events**: Production events are append-only logs. A leader can only create an event if they are authenticated. Updates/deletes are strictly forbidden to ensure audit trail integrity.
5. **Rotations**: Weekly rotations are readable by all authenticated users, writable only by coordinators.

## 2. The "Dirty Dozen" Payloads
1. **Identity Spoofing**: Leader A tries to create an event with Leader B's ID.
2. **State Shortcutting**: Leader changes OP status to 'completed' without sending a FINISHED event.
3. **Resource Poisoning**: Pushing 1MB string into OP description.
4. **Role Escalation**: Leader tries to update their own role to 'coordinator' in the users table.
5. **Orphaned Write**: Leader tries to create an event for a non-existent OP.
6. **Shadow Update**: Coordinator adds a 'superAdmin' field to the rotation document.
7. **PII Blanket**: Anonymous user tries to read the users collection.
8. **Time Tampering**: Leader tries to create an event with a timestamp from 2 days ago.
9. **Event Deletion**: Admin tries to delete a production event to cover up a mistake.
10. **Quantity Poisoning**: Leader sets producedQuantity to a negative number.
11. **Negative Pauses**: Leader submits an event with negative quantity.
12. **Lock Bypassing**: Leader tries to modify an OP that has already been marked 'completed'.

## 3. The Test Runner
(We will write the `firestore.rules.test.ts` to assert these behaviors in a real test suite later, assuming test execution is available).
