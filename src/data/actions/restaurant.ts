/**
 * RESTAURANT, KITCHEN, APPROVAL AND PRICE-LIST ACTIONS.
 *
 * Moved out of AppDataContext.tsx, which had grown past seventeen hundred
 * lines. The actions are unchanged; the provider hands them its commit,
 * permission check and current books when it builds the app's API.
 */
import type { MutableRefObject } from 'react';
import type { DB, ModifierGroup, Ticket, MenuGroup, Menu, PriceList, KitchenOrder, ApprovalRequest } from '../types';
import type { Ctx } from '../AppDataContext';
import { uid, iso } from '../uid';
import * as logic from '../logic';
import { activeBranchId } from '../branch';
import { Refusal } from '../refusal';

type Names = 'saveModifierGroup' | 'removeModifierGroup' | 'saveTicket' | 'saveMenuGroup' | 'removeMenuGroup' | 'moveMenuGroup' | 'requestApproval' | 'decideApproval' | 'sendKitchenOrder' | 'setKitchenStatus' | 'savePriceList' | 'saveMenu' | 'removeMenu' | 'closeTicket' | 'voidTicket';

export function restaurantActions(deps: {
  commit: (mut: (d: DB) => void) => void;
  requirePerm: (key: string) => void;
  dbRef: MutableRefObject<DB | null>;
}): Pick<Ctx, Names> {
  const { commit, requirePerm, dbRef } = deps;
  const { audit } = logic;
  void Refusal;
  return {
    saveModifierGroup: (g) => {
      requirePerm('inventory.edit');
      let out!: ModifierGroup;
      commit((d) => {
        d.modifierGroups = d.modifierGroups || [];
        const clean = { name: g.name.trim(), required: !!g.required, multi: !!g.multi, options: g.options.filter((o) => o.name.trim()).map((o) => ({ ...o, name: o.name.trim(), price: Math.max(0, Number(o.price) || 0) })) };
        const i = g.id ? d.modifierGroups.findIndex((x) => x.id === g.id) : -1;
        out = i >= 0 ? { ...d.modifierGroups[i], ...clean } : { id: uid('mod'), ...clean };
        if (i >= 0) d.modifierGroups[i] = out; else d.modifierGroups.push(out);
        logic.enqueue(d, 'modifierGroup', out.id);
      });
      return out;
    },
    removeModifierGroup: (id) => {
      requirePerm('inventory.edit');
      commit((d) => {
        d.modifierGroups = (d.modifierGroups || []).filter((g) => g.id !== id);
        d.products.forEach((p) => {
          if (p.modifierGroups?.includes(id)) { p.modifierGroups = p.modifierGroups.filter((x) => x !== id); logic.enqueue(d, 'product', p.id); }
        });
      });
    },
    saveTicket: (t) => {
      requirePerm('sales.create');
      let out!: Ticket;
      commit((d) => {
        d.tickets = d.tickets || [];
        const now = iso(new Date());
        const i = t.id ? d.tickets.findIndex((x) => x.id === t.id) : -1;
        if (i >= 0) {
          out = { ...d.tickets[i], name: t.name, lines: t.lines, sent: t.sent, updatedAt: now, orderType: t.orderType, guests: t.guests, note: t.note || undefined,
            partyId: t.partyId || undefined, address: t.address || undefined, phone: t.phone || undefined };
          d.tickets[i] = out;
        } else {
          const n = d.tickets.length + 1;
          out = {
            id: uid('tkt'), no: 'T' + String(n).padStart(3, '0'), name: t.name || 'Ticket ' + n, ts: now, updatedAt: now,
            lines: t.lines, sent: t.sent, status: 'open', userId: d.session.userId, branch: activeBranchId(d),
            ...(t.orderType ? { orderType: t.orderType } : {}), ...(t.guests ? { guests: t.guests } : {}), ...(t.note ? { note: t.note } : {}),
            ...(t.partyId ? { partyId: t.partyId } : {}), ...(t.address ? { address: t.address } : {}), ...(t.phone ? { phone: t.phone } : {}),
          };
          d.tickets.push(out);
        }
        logic.enqueue(d, 'ticket', out.id);
      });
      return out;
    },
    saveMenuGroup: (g) => {
      requirePerm('inventory.edit');
      let out!: MenuGroup;
      commit((d) => {
        d.menuGroups = d.menuGroups || [];
        const i = g.id ? d.menuGroups.findIndex((x) => x.id === g.id) : -1;
        const name = g.name.trim();
        if (i >= 0) {
          const before = d.menuGroups[i].name;
          out = { ...d.menuGroups[i], name, color: g.color, station: g.station || undefined };
          d.menuGroups[i] = out;
          // a renamed section keeps its dishes
          if (before !== name) d.products.forEach((p) => { if (p.category === before) { p.category = name; logic.enqueue(d, 'product', p.id); } });
        } else {
          out = { id: uid('mgp'), name, color: g.color, station: g.station || undefined, sort: d.menuGroups.length };
          d.menuGroups.push(out);
        }
        if (!d.categories.includes(name)) d.categories.push(name);
        logic.enqueue(d, 'menuGroup', out.id);
      });
      return out;
    },
    removeMenuGroup: (id) => {
      requirePerm('inventory.edit');
      commit((d) => {
        const g = (d.menuGroups || []).find((x) => x.id === id);
        if (!g) return;
        d.products.forEach((p) => { if (p.category === g.name) { p.category = 'Other'; logic.enqueue(d, 'product', p.id); } });
        d.menuGroups = (d.menuGroups || []).filter((x) => x.id !== id);
        d.menuGroups.forEach((x, i) => { x.sort = i; });
      });
    },
    moveMenuGroup: (id, by) => {
      requirePerm('inventory.edit');
      commit((d) => {
        const list = [...(d.menuGroups || [])].sort((a, b) => a.sort - b.sort);
        const i = list.findIndex((x) => x.id === id);
        const j = i + by;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        list.forEach((x, k) => { x.sort = k; logic.enqueue(d, 'menuGroup', x.id); });
        d.menuGroups = list;
      });
    },
    requestApproval: (what) => {
      let out!: ApprovalRequest;
      commit((d) => {
        const me = d.users.find((u) => u.id === d.session.userId);
        out = { id: uid('apr'), what, byId: d.session.userId, by: me?.name || 'Staff', at: iso(new Date()), status: 'pending' };
        d.approvals = [...(d.approvals || []).filter((a) => a.status === 'pending' || Date.now() - new Date(a.at).getTime() < 7 * 864e5), out];
        logic.enqueue(d, 'approval', out.id);
      });
      return out;
    },
    decideApproval: (id, approve) => {
      // only someone who could have typed the owner PIN may answer
      if (dbRef.current?.session.role !== 'owner') requirePerm('profiles.manage');
      commit((d) => {
        const a = (d.approvals || []).find((x) => x.id === id);
        if (!a || a.status !== 'pending') return;
        a.status = approve ? 'approved' : 'declined';
        a.decidedBy = d.users.find((u) => u.id === d.session.userId)?.name || 'Owner';
        a.decidedAt = iso(new Date());
        audit(d, approve ? 'Approved' : 'Declined', a.what + ' — asked by ' + a.by);
        logic.enqueue(d, 'approval', id);
      });
    },
    sendKitchenOrder: (k) => {
      let out!: KitchenOrder;
      commit((d) => {
        const now = iso(new Date());
        d.kitchenOrders = d.kitchenOrders || [];
        out = { ...k, id: uid('kot'), sentAt: now, changedAt: now, status: 'new' };
        d.kitchenOrders.push(out);
        // the display only needs today's work: served orders older than two days are let go
        const old = Date.now() - 2 * 864e5;
        d.kitchenOrders = d.kitchenOrders.filter((x) => x.status !== 'served' || new Date(x.changedAt).getTime() > old);
        logic.enqueue(d, 'kitchenOrder', out.id);
      });
      return out;
    },
    setKitchenStatus: (id, status) => {
      requirePerm('restaurant.kitchen');
      commit((d) => {
        const x = (d.kitchenOrders || []).find((k) => k.id === id);
        if (!x) return;
        x.status = status; x.changedAt = iso(new Date());
        logic.enqueue(d, 'kitchenOrder', id);
      });
    },
    savePriceList: (l) => {
      requirePerm('inventory.bulk_edit');
      let out!: PriceList;
      commit((d) => {
        d.priceLists = d.priceLists || [];
        const now = iso(new Date());
        const i = l.id ? d.priceLists.findIndex((x) => x.id === l.id) : -1;
        out = i >= 0 ? { ...d.priceLists[i], ...l, id: d.priceLists[i].id, updatedAt: now } as PriceList
          : { ...l, id: uid('prl'), createdAt: now, updatedAt: now } as PriceList;
        if (i >= 0) d.priceLists[i] = out; else d.priceLists.unshift(out);
        logic.enqueue(d, 'priceList', out.id);
      });
      return out;
    },
    saveMenu: (m) => {
      requirePerm('inventory.edit');
      let out!: Menu;
      commit((d) => {
        d.menus = d.menus || [];
        const i = m.id ? d.menus.findIndex((x) => x.id === m.id) : -1;
        out = { id: i >= 0 ? d.menus[i].id : uid('mnu'), name: m.name.trim(), sections: m.sections };
        if (i >= 0) d.menus[i] = out; else d.menus.push(out);
        logic.enqueue(d, 'menu', out.id);
      });
      return out;
    },
    removeMenu: (id) => {
      requirePerm('inventory.edit');
      commit((d) => {
        d.menus = (d.menus || []).filter((x) => x.id !== id);
        // nobody stays tied to a menu that is gone
        d.users.forEach((u) => { if (u.menuId === id) { delete u.menuId; logic.enqueue(d, 'user', u.id); } });
      });
    },
    closeTicket: (id, saleId) => commit((d) => {
      const x = (d.tickets || []).find((k) => k.id === id);
      if (x) { x.status = 'closed'; x.saleId = saleId; x.updatedAt = iso(new Date()); logic.enqueue(d, 'ticket', id); }
    }),
    voidTicket: (id) => { requirePerm('restaurant.cancel'); commit((d) => {
      const x = (d.tickets || []).find((k) => k.id === id);
      if (x && x.status === 'open') { x.status = 'void'; x.updatedAt = iso(new Date()); audit(d, 'Ticket cancelled', x.no + ' ' + x.name); logic.enqueue(d, 'ticket', id); }
    }); },
  };
}
