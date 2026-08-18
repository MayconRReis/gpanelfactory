import { collection, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ProductionLine, ProductionOrder } from '../types';

export const seedDatabase = async () => {
  const batch = writeBatch(db);

  // 1. Linhas
  const lines: ProductionLine[] = [
    { id: 'line-1', name: 'Linha 01', status: 'idle', currentOpId: null },
    { id: 'line-2', name: 'Linha 02', status: 'idle', currentOpId: null },
    { id: 'line-3', name: 'Linha 03', status: 'idle', currentOpId: null },
    { id: 'line-geral', name: 'Linha Geral', status: 'idle', currentOpId: null },
  ];

  for (const line of lines) {
    const ref = doc(db, 'lines', line.id);
    batch.set(ref, line);
  }

  // 2. OPs Iniciais
  const ops: Omit<ProductionOrder, 'id'>[] = [
    { number: '40231', product: 'Shampoo Hidratante X', plannedQuantity: 2000, producedQuantity: 0, priority: 'Crítica', status: 'pending', lineId: 'line-1', leaderId: null, packageAvailability: 5000, sequence: 1, createdAt: new Date().toISOString() },
    { number: '40232', product: 'Condicionador Revital', plannedQuantity: 2000, producedQuantity: 0, priority: 'Alta', status: 'pending', lineId: 'line-2', leaderId: null, packageAvailability: 1000, sequence: 1, createdAt: new Date().toISOString() },
    { number: '40233', product: 'Máscara Capilar Pro', plannedQuantity: 3000, producedQuantity: 0, priority: 'Normal', status: 'pending', lineId: 'line-3', leaderId: null, packageAvailability: 0, sequence: 1, createdAt: new Date().toISOString() },
    { number: '40234', product: 'Sleeve Térmico L2', plannedQuantity: 1000, producedQuantity: 0, priority: 'Baixa', status: 'pending', lineId: 'line-geral', leaderId: null, packageAvailability: 1000, sequence: 1, createdAt: new Date().toISOString() },
    
    // Fila Linha 1
    { number: '40235', product: 'Kit Presente Natalino', plannedQuantity: 500, producedQuantity: 0, priority: 'Crítica', status: 'pending', lineId: 'line-1', leaderId: null, packageAvailability: 1000, sequence: 2, createdAt: new Date().toISOString() },
    { number: '40236', product: 'Sabonete Líquido Erva Doce', plannedQuantity: 4000, producedQuantity: 0, priority: 'Normal', status: 'pending', lineId: 'line-1', leaderId: null, packageAvailability: 5000, sequence: 3, createdAt: new Date().toISOString() },
    
    // Fila Linha 2
    { number: '40237', product: 'Tônico Facial Suave', plannedQuantity: 2200, producedQuantity: 0, priority: 'Normal', status: 'pending', lineId: 'line-2', leaderId: null, packageAvailability: 3000, sequence: 2, createdAt: new Date().toISOString() },
  ];

  for (const op of ops) {
    const ref = doc(collection(db, 'ops'));
    batch.set(ref, op);
  }

  await batch.commit();
  console.log('Database seeded successfully!');
};
