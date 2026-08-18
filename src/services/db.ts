import { collection, doc, getDoc, getDocs, query, where, updateDoc, addDoc, serverTimestamp, orderBy, limit, increment, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ProductionLine, ProductionOrder, UserProfile } from '../types';

export const getProfile = async (uid: string): Promise<UserProfile | null> => {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  } catch (error) {
    console.error("Error fetching profile:", error);
    throw new Error("Não foi possível carregar o perfil.");
  }
};

export const startOP = async (opId: string, lineId: string, leaderId: string) => {
  try {
    await runTransaction(db, async (transaction) => {
      const opRef = doc(db, 'ops', opId);
      const lineRef = doc(db, 'lines', lineId);
      
      transaction.update(opRef, { status: 'in_progress', leaderId });
      transaction.update(lineRef, { status: 'active', currentOpId: opId });
      
      const eventRef = doc(collection(db, 'events'));
      transaction.set(eventRef, {
        opId, lineId, leaderId, type: 'STARTED', timestamp: serverTimestamp()
      });
    });
  } catch (error) {
    console.error("Error starting OP:", error);
    throw new Error("Não foi possível iniciar a produção.");
  }
};

export const reportQuantity = async (opId: string, lineId: string, leaderId: string, quantity: number) => {
  try {
    await runTransaction(db, async (transaction) => {
      const opRef = doc(db, 'ops', opId);
      transaction.update(opRef, { producedQuantity: increment(quantity) });
      
      const eventRef = doc(collection(db, 'events'));
      transaction.set(eventRef, {
        opId, lineId, leaderId, type: 'QUANTITY_REPORTED', quantity, timestamp: serverTimestamp()
      });
    });
  } catch (error) {
    console.error("Error reporting quantity:", error);
    throw new Error("Não foi possível registrar a produção.");
  }
};

// ... (keep other functions like pauseOP, resumeOP, finishOP with similar try-catch patterns) ...
export const pauseOP = async (opId: string, lineId: string, leaderId: string, reason: string, observation: string) => {
  try {
    await runTransaction(db, async (transaction) => {
      const opRef = doc(db, 'ops', opId);
      const lineRef = doc(db, 'lines', lineId);
      
      transaction.update(opRef, { status: 'paused' });
      transaction.update(lineRef, { status: 'paused' });
      
      const eventRef = doc(collection(db, 'events'));
      transaction.set(eventRef, {
        opId, lineId, leaderId, type: 'PAUSED', reason, observation, timestamp: serverTimestamp()
      });
    });
  } catch (error) {
    console.error("Error pausing OP:", error);
    throw new Error("Não foi possível pausar a produção.");
  }
};

export const resumeOP = async (opId: string, lineId: string, leaderId: string) => {
  try {
    await runTransaction(db, async (transaction) => {
      const opRef = doc(db, 'ops', opId);
      const lineRef = doc(db, 'lines', lineId);
      
      transaction.update(opRef, { status: 'in_progress' });
      transaction.update(lineRef, { status: 'active' });
      
      const eventRef = doc(collection(db, 'events'));
      transaction.set(eventRef, {
        opId, lineId, leaderId, type: 'RESUMED', timestamp: serverTimestamp()
      });
    });
  } catch (error) {
    console.error("Error resuming OP:", error);
    throw new Error("Não foi possível retomar a produção.");
  }
};

export const finishOP = async (opId: string, lineId: string, leaderId: string) => {
  try {
    await runTransaction(db, async (transaction) => {
      const opRef = doc(db, 'ops', opId);
      const lineRef = doc(db, 'lines', lineId);
      
      transaction.update(opRef, { status: 'completed' });
      transaction.update(lineRef, { status: 'idle', currentOpId: null });
      
      const eventRef = doc(collection(db, 'events'));
      transaction.set(eventRef, {
        opId, lineId, leaderId, type: 'FINISHED', timestamp: serverTimestamp()
      });
    });
  } catch (error) {
    console.error("Error finishing OP:", error);
    throw new Error("Não foi possível finalizar a produção.");
  }
};

export const getLines = async (): Promise<ProductionLine[]> => {
  const snap = await getDocs(collection(db, 'lines'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionLine));
};

export const getActiveOP = async (lineId: string): Promise<ProductionOrder | null> => {
  const q = query(
    collection(db, 'ops'), 
    where('lineId', '==', lineId),
    where('status', 'in', ['in_progress', 'paused'])
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as ProductionOrder;
  }
  
  const nextQ = query(
    collection(db, 'ops'),
    where('lineId', '==', lineId),
    where('status', '==', 'pending'),
    orderBy('sequence', 'asc'),
    limit(1)
  );
  const nextSnap = await getDocs(nextQ);
  if (!nextSnap.empty) {
    return { id: nextSnap.docs[0].id, ...nextSnap.docs[0].data() } as ProductionOrder;
  }
  return null;
};

export const getAllOPs = async (): Promise<ProductionOrder[]> => {
  const snap = await getDocs(collection(db, 'ops'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionOrder));
};

export const getLeaderRotation = async (leaderId: string): Promise<string | null> => {
  // Logic to query rotation table
  const q = query(collection(db, 'rotations'), where('leaderId', '==', leaderId)); // Need to adjust schema later
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].data().lineId;
};
