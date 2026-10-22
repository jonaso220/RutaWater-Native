import { planClearCompleted } from '../clearCompleted';
import { Client } from '../../types';

const client = (data: Partial<Client>): Client => ({
  id: 'x', name: '', phone: '', phones: [], address: '', notes: '', freq: 'weekly', visitDay: 'Jueves',
  visitDays: ['Jueves'], specificDate: '', products: {}, isStarred: false, isCompleted: false, isNote: false,
  ...data,
} as Client);

describe('Borrar completados', () => {
  const agenda = client({ id: 'agenda', name: 'Laura', lastDeliveredAt: new Date('2026-10-15T12:00:00') as any });
  const extra = client({
    id: 'extra', customerId: 'agenda', name: 'Laura', freq: 'once', specificDate: '2026-10-22', isCompleted: true,
    completedAt: new Date('2026-10-22T12:00:00') as any,
  });

  test('el pedido extra de un cliente en agenda se borra y su entrega pasa a la ficha de agenda', () => {
    const plan = planClearCompleted([extra], [agenda, extra]);
    expect(plan.actions).toEqual([{ kind: 'delete-extra', client: extra, keeperId: 'agenda' }]);
    expect(plan.keeperDeliveries.get('agenda')).toEqual(new Date('2026-10-22T12:00:00'));
  });

  test('un pedido de una vez de alguien que no tiene otra ficha vuelve al Directorio, como antes', () => {
    const alone = client({ id: 'solo', freq: 'once', isCompleted: true });
    expect(planClearCompleted([alone], [alone, agenda]).actions).toEqual([{ kind: 'to-directory', client: alone }]);
  });

  test('con una copia en el Directorio, se borra el pedido y queda la copia', () => {
    const copy = client({ id: 'copia', customerId: 'agenda2', freq: 'on_demand', visitDays: [] });
    const order = client({ id: 'pedido', customerId: 'agenda2', freq: 'once', isCompleted: true });
    expect(planClearCompleted([order], [copy, order]).actions).toEqual([{ kind: 'delete-extra', client: order, keeperId: 'copia' }]);
  });

  test('dos pedidos completados del mismo cliente sin otra ficha: uno vuelve al Directorio y el otro se borra', () => {
    const a = client({ id: 'a', freq: 'once', isCompleted: true });
    const b = client({ id: 'b', customerId: 'a', freq: 'once', isCompleted: true, completedAt: new Date('2026-10-22T15:00:00') as any });
    const plan = planClearCompleted([a, b], [a, b]);
    expect(plan.actions.map((action) => action.kind)).toEqual(['to-directory', 'delete-extra']);
    expect(plan.keeperDeliveries.get('a')).toEqual(new Date('2026-10-22T15:00:00'));
  });

  test('las notas se borran y no cuentan como ficha del cliente', () => {
    const note = client({ id: 'nota', isNote: true, isCompleted: true });
    expect(planClearCompleted([note], [note]).actions).toEqual([{ kind: 'delete-note', client: note }]);
  });

  test('no pisa una entrega más nueva de la ficha que queda', () => {
    const recent = client({ id: 'agenda3', lastDeliveredAt: new Date('2026-10-23T12:00:00') as any });
    const old = client({ id: 'viejo', customerId: 'agenda3', freq: 'once', isCompleted: true, completedAt: new Date('2026-10-22T12:00:00') as any });
    expect(planClearCompleted([old], [recent, old]).keeperDeliveries.size).toBe(0);
  });
});
