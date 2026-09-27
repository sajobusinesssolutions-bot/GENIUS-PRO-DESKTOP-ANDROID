import type { BulkKind, BulkPlan } from '../data/logic';

export type RootStackParamList = {
  Welcome: undefined;
  PinLock: { userId?: string } | undefined;
  Onboarding: undefined;
  Businesses: undefined;
  Main: { screen?: keyof TabParamList } | undefined;

  MenuGroup: { groupId: string };

  // Sell
  NewSale: { editSaleId?: string } | undefined;
  Receipt: { saleId: string };
  Sales: undefined;
  SaleDetail: { saleId: string };
  EditSale: { saleId: string };
  Estimates: undefined;
  EstimateNew: undefined;
  Challans: undefined;
  ChallanNew: { saleId?: string } | undefined;
  CreditNotes: undefined;
  CreditNoteNew: { saleId?: string } | undefined;
  Offers: undefined;
  OfferNew: undefined;
  Recurring: undefined;
  RecurringNew: undefined;
  Instalments: undefined;
  PlanDetail: { planId: string };
  PlanNew: { saleId?: string } | undefined;

  // Buy
  Purchases: undefined;
  PurchaseDetail: { purchaseId: string };
  EditPurchase: { purchaseId: string };
  PurchaseNew: { editPurchaseId?: string } | undefined;
  PurchaseOrders: undefined;
  PurchaseOrderNew: undefined;

  // People
  Parties: undefined;
  PartyDetail: { partyId: string };
  PartyEdit: { partyId?: string; type?: 'customer' | 'supplier' } | undefined;
  PartyLedger: { partyId: string };
  Loyalty: undefined;
  UsersRoles: undefined;

  // Stock
  ProductDetail: { productId?: string } | undefined;
  ItemDetail: { productId: string };
  StockAdjust: undefined;
  StockTransfer: undefined;
  Batches: undefined;
  StaffReport: undefined;
  PriceList: undefined;
  NamesEditor: undefined;
  ActivateItems: undefined;
  PriceTags: undefined;
  AuthGate: undefined;
  Developer: undefined;
  SignIn: undefined;
  CreateAccount: undefined;
  GoogleSignIn: undefined;
  Branches: undefined;
  NewBranch: undefined;
  BranchAnalysis: undefined;
  AccountingHub: undefined;
  Reconciliation: undefined;
  ChartOfAccounts: undefined;
  LedgerDetail: { ledgerId: string };
  JournalEntry: undefined;
  TrialBalance: undefined;
  BatchMovement: undefined;
  StockTakes: undefined;
  StockTakeDetail: { stockTakeId: string };
  Production: undefined;
  Warranties: undefined;
  UnitsCategories: undefined;
  BulkChange: { kind: BulkKind };
  BulkPreview: { plan: BulkPlan };

  // Books
  Money: undefined;
  AccountDetail: { accountId: string; period?: string; from?: number; to?: number };
  PaymentDetail: { paymentId: string };
  PaymentNew: { direction?: 'in' | 'out'; partyId?: string } | undefined;
  EntryNew: { direction?: 'in' | 'out' } | undefined;
  Transfer: undefined;
  Accounting: undefined;
  Journals: undefined;
  Reports: { id?: string } | undefined;
  ReportDetail: { id: string };
  Tax: undefined;

  // Business
  Shift: { open?: boolean; close?: boolean } | undefined;
  Settings: undefined;
  Printing: undefined;
  PrintingReceipt: undefined;
  PrintingInvoice: undefined;
  Legal: { doc?: 'privacy' | 'terms' } | undefined;
  DataTools: { backup?: boolean } | undefined;
  Business: undefined;
  Firms: undefined;
  AuditLog: undefined;
  Notifications: undefined;
  Plans: undefined;
  About: undefined;
  Licence: undefined;
  LicenceStop: undefined;
  Install: undefined;
  Update: undefined;
  Sync: undefined;
  Online: undefined;
  Versions: { coll: string; recordId: string };
};

/** The four live tabs — reference BAR, line 5409. */
export type TabParamList = {
  DashboardTab: undefined;
  SalesTab: undefined;
  ItemsTab: undefined;
  MenuTab: undefined;
};
