import { supabase } from '../lib/supabase';
import { ProductionLine, ProductionOrder } from '../types';

/**
 * Seed function to populate Supabase database with demo data
 * Only run this in development environment
 */
export const seedDatabase = async () => {
  try {
    console.log('Starting database seed...');

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User not authenticated');
    }

    // ============ CREATE PRODUCTION LINES ============
    const linesToCreate = [
      { name: 'LINHA 01 - ENCHIMENTO' },
      { name: 'LINHA 02 - ROTULAGEM' },
      { name: 'LINHA 03 - EMBALAGEM' },
      { name: 'LINHA 04 - QUALIDADE' },
    ];

    const { data: linesData, error: linesError } = await supabase
      .from('production_lines')
      .insert(linesToCreate)
      .select();

    if (linesError) throw linesError;
    console.log('✓ Production lines created:', linesData?.length);

    // ============ CREATE PRODUCTION ORDERS ============
    const lines = linesData || [];
    const ordersToCreate: any[] = [];

    const products = [
      { name: 'Suco Natural - Laranja 1L', planned: 1000 },
      { name: 'Suco Natural - Maçã 1L', planned: 800 },
      { name: 'Suco Natural - Uva 1L', planned: 600 },
      { name: 'Suco Natural - Morango 500ml', planned: 500 },
      { name: 'Néctar - Pêssego 1L', planned: 750 },
      { name: 'Néctar - Abacaxi 1L', planned: 900 },
      { name: 'Refrigerante - Cola 2L', planned: 400 },
      { name: 'Água Mineral - 5L', planned: 1200 },
    ];

    const priorities: Array<'Crítica' | 'Alta' | 'Normal' | 'Baixa'> = ['Crítica', 'Alta', 'Normal', 'Baixa'];

    products.forEach((product, index) => {
      ordersToCreate.push({
        number: `OP-2024-${String(index + 1).padStart(4, '0')}`,
        product: product.name,
        planned_quantity: product.planned,
        produced_quantity: Math.floor(Math.random() * product.planned),
        priority: priorities[Math.floor(Math.random() * priorities.length)],
        status: ['pending', 'in_progress', 'paused', 'completed'][Math.floor(Math.random() * 4)],
        line_id: lines[Math.floor(Math.random() * lines.length)]?.id || null,
        leader_id: user.id,
        package_availability: Math.floor(Math.random() * 500),
        sequence: index,
      });
    });

    const { data: ordersData, error: ordersError } = await supabase
      .from('production_orders')
      .insert(ordersToCreate)
      .select();

    if (ordersError) throw ordersError;
    console.log('✓ Production orders created:', ordersData?.length);

    // ============ CREATE PRODUCTION EVENTS ============
    const eventsToCreate: any[] = [];
    const eventTypes = ['STARTED', 'PAUSED', 'RESUMED', 'FINISHED', 'QUANTITY_REPORTED'];

    (ordersData || []).slice(0, 4).forEach((order) => {
      eventsToCreate.push({
        op_id: order.id,
        line_id: order.line_id,
        leader_id: user.id,
        type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
        quantity: Math.floor(Math.random() * 500),
        reason: 'Demo pause reason',
        observation: 'Demo observation',
      });
    });

    if (eventsToCreate.length > 0) {
      const { error: eventsError } = await supabase
        .from('production_events')
        .insert(eventsToCreate);

      if (eventsError) throw eventsError;
      console.log('✓ Production events created:', eventsToCreate.length);
    }

    // ============ CREATE WEEKLY ROTATIONS ============
    const week = getWeekNumber(new Date());
    const year = new Date().getFullYear();

    const rotationsToCreate = lines.map((line) => ({
      week_number: week,
      year,
      leader_id: user.id,
      line_id: line.id,
    }));

    const { error: rotationsError } = await supabase
      .from('weekly_rotations')
      .insert(rotationsToCreate);

    if (rotationsError) throw rotationsError;
    console.log('✓ Weekly rotations created:', rotationsToCreate.length);

    alert('✓ Database seeded successfully!');
    window.location.reload();
  } catch (error: any) {
    console.error('Error seeding database:', error.message);
    alert(`Error seeding database: ${error.message}`);
  }
};

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
