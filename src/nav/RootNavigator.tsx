import React from 'react';
import { requestSync } from '../data/SyncKeeper';
import { Platform } from 'react-native';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, DefaultTheme, DarkTheme } from '@react-navigation/native';
import AppLock from './AppLock';

/** Shared so the app lock can send the till back to the PIN from anywhere. */
export const navRef = createNavigationContainerRef<any>();
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppData } from '../data/AppDataContext';
import { useTheme } from '../theme';
import { NavHeader } from '../components/AppBar';

import WelcomeScreen from '../screens/WelcomeScreen';
import { AuthGateScreen, SignInScreen, CreateAccountScreen } from '../screens/AuthScreens';
import GoogleSignInScreen from '../screens/GoogleSignInScreen';
import { useAuth } from '../data/AuthContext';
import KeyboardSafe from '../components/KeyboardSafe';
import RouteGuard from './RouteGuard';
import PinLockScreen from '../screens/PinLockScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import BusinessesScreen from '../screens/BusinessesScreen';
import MainTabs from './MainTabs';
import NewSaleScreen from '../screens/NewSaleScreen';
import ReceiptScreen from '../screens/ReceiptScreen';
import ProductDetailScreen, { UnitsCategoriesScreen } from '../screens/ProductDetailScreen';
import ItemDetailScreen from '../screens/ItemDetailScreen';
import BatchReportScreen from '../screens/BatchReportScreen';
import StaffReportScreen from '../screens/StaffReportScreen';
import BatchMovementScreen from '../screens/BatchMovementScreen';
import { BranchesScreen, BranchAnalysisScreen } from '../screens/BranchScreens';
import { PriceListScreen, NamesEditorScreen, ActivateScreen } from '../screens/BulkEditScreens';
import PriceTagScreen from '../screens/PriceTagScreen';
import NewBranchScreen from '../screens/NewBranchScreen';
import DeveloperScreen from '../screens/DeveloperScreen';
import {
  AccountingHubScreen, ChartOfAccountsScreen, LedgerDetailScreen, JournalEntryScreen, TrialBalanceScreen, ReconciliationScreen,
} from '../screens/AccountingScreens';
import PartyDetailScreen from '../screens/PartyDetailScreen';
import PartyEditScreen from '../screens/PartyEditScreen';
import PartyLedgerScreen from '../screens/PartyLedgerScreen';
import PurchaseNewScreen from '../screens/PurchaseNewScreen';
import PaymentNewScreen from '../screens/PaymentNewScreen';
import VyaparImportScreen from '../screens/VyaparImportScreen';
import ReminderSettingsScreen from '../screens/ReminderSettingsScreen';
import UsersRolesScreen from '../screens/UsersRolesScreen';
import BusinessScreen from '../screens/BusinessScreen';
import WarrantiesScreen from '../screens/WarrantiesScreen';
import SaleDetailScreen from '../screens/SaleDetailScreen';
import EditSaleScreen from '../screens/EditSaleScreen';
import EditPurchaseScreen from '../screens/EditPurchaseScreen';
import PurchaseDetailScreen from '../screens/PurchaseDetailScreen';
import PaymentDetailScreen from '../screens/PaymentDetailScreen';
import EstimatesScreen from '../screens/EstimatesScreen';
import EstimateNewScreen from '../screens/EstimateNewScreen';
import ChallansScreen, { ChallanNewScreen } from '../screens/ChallansScreen';
import CreditNotesScreen, { CreditNoteNewScreen } from '../screens/CreditNotesScreen';
import OffersScreen, { OfferNewScreen } from '../screens/OffersScreen';
import StockTakesScreen, { StockTakeDetailScreen } from '../screens/StockTakesScreen';
import PurchaseOrdersScreen, { PurchaseOrderNewScreen } from '../screens/PurchaseOrdersScreen';
import ProductionScreen from '../screens/ProductionScreen';
import RecurringScreen, { RecurringNewScreen } from '../screens/RecurringScreen';
import ShiftScreen from '../screens/ShiftScreen';
import FirmsScreen from '../screens/FirmsScreen';
import AuditLogScreen from '../screens/AuditLogScreen';

// Destinations the live menu groups and quick actions point at
import SalesListScreen from '../screens/SalesListScreen';
import PartiesScreen from '../screens/PartiesScreen';
import PurchasesScreen from '../screens/PurchasesScreen';
import MoneyScreen from '../screens/MoneyScreen';
import ReportsScreen from '../screens/ReportsScreen';
import ReportDetailScreen from '../screens/ReportDetailScreen';
import MenuGroupScreen from '../screens/MenuGroupScreen';
import { EntryNewScreen, TransferScreen } from '../screens/MoneyEntryScreens';
import CashEntriesScreen from '../screens/CashEntriesScreen';
import { StockAdjustScreen, StockTransferScreen } from '../screens/StockScreens';
import { AccountingScreen, JournalsScreen, TaxScreen, AccountDetailScreen } from '../screens/BooksScreens';
import {
  SettingsScreen, DataToolsScreen, LoyaltyScreen, NotificationsScreen,
} from '../screens/AdminScreens';
import PrintingScreen, { ReceiptSettingsScreen, InvoiceSettingsScreen } from '../screens/PrintingScreen';
import LegalScreen from '../screens/LegalScreen';
import HelpScreen, { FaqScreen } from '../screens/HelpScreen';
import { InstalmentsScreen, PlanDetailScreen, PlanNewScreen } from '../screens/InstalmentScreens';
import { BulkChangeScreen, BulkPreviewScreen } from '../screens/BulkScreens';
import {
  LicenceScreen, LicenceStopScreen, SyncScreen,
  OnlineScreen, VersionsScreen, AboutScreen,
} from '../screens/SystemScreens';
import type { RootStackParamList } from './types';
import { licBlocks } from '../data/logic';
import { AfterTransition } from '../components/Skeleton';
import ErrorBoundary from '../components/ErrorBoundary';

const Stack = createNativeStackNavigator<RootStackParamList>();

/* Screens that open without a slide, or are the first thing seen: no skeleton. */
const NO_SKELETON = new Set(['AuthGate', 'SignIn', 'CreateAccount', 'GoogleSignIn', 'Welcome', 'Onboarding', 'PinLock', 'Businesses', 'Main', 'LicenceStop']);

/** A pushed screen shows its skeleton while it slides in, and its content once it has arrived. */
function Deferred({ navigation, children }: { navigation: any; children: React.ReactNode }) {
  const subscribe = React.useCallback((done: () => void) => navigation.addListener('transitionEnd', (e: any) => {
    if (!e?.data?.closing) done();
  }), [navigation]);
  return <AfterTransition subscribe={subscribe}>{children}</AfterTransition>;
}

export default function RootNavigator() {
  const { ready, db } = useAppData();
  const { ready: authReady, signedIn } = useAuth();
  const { colors, dark } = useTheme();
  /* Every screen sits on the app's own background. Without it a fading or
     sliding screen shows the black window behind it for a moment. */
  const navTheme = React.useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: colors.bg, card: colors.surface, border: colors.line, text: colors.ink, primary: colors.accent } };
  }, [dark, colors]);

  if (!ready || !authReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  /*
   * Where the app opens.
   *
   *   no account        → sign in or create one. Asked once, on this device.
   *   account, no shop  → carry on into setting the business up.
   *   everything set    → the PIN of whichever member of staff is on the counter.
   *
   * A licence that has run out does not hide the books: it stops new records
   * being written, which the recording gate enforces at the point of saving.
   * The LicenceStop screen is still shown first so nobody has to discover it
   * halfway through a sale.
   */
  const initialRoute = !signedIn
    ? 'AuthGate'
    : !db?.onboarded
      ? 'Onboarding'
      : licBlocks(db)
        ? 'LicenceStop'
        : 'PinLock';

  return (
    <NavigationContainer ref={navRef} theme={navTheme}>
      <AppLock nav={navRef} />
      <Stack.Navigator
        initialRouteName={initialRoute}
        /* each screen that opens asks the cloud for anything new — see SyncKeeper */
        screenListeners={{ focus: () => requestSync() }}
        /* every screen keeps its fields and its Save bar above the keyboard — see KeyboardSafe */
        /* every screen: fields stay above the keyboard, and the role is checked — see RouteGuard */
        screenLayout={({ children, route, navigation }) => (
          <KeyboardSafe>
            <RouteGuard route={route.name} params={route.params}>
              {/* a screen that fails to draw shows a way back, and is reported */}
              <ErrorBoundary>
                {NO_SKELETON.has(route.name) ? children : <Deferred navigation={navigation}>{children}</Deferred>}
              </ErrorBoundary>
            </RouteGuard>
          </KeyboardSafe>
        )}
        /* one shared header for every screen — reference render(), lines 1529-1536 */
        screenOptions={{
          header: (props) => <NavHeader {...props} />,
          contentStyle: { backgroundColor: colors.bg },
          // Android: no system animation. Its screen animations fade, and a fading
          // screen draws every card's shadow as a dark block — the black boxes.
          // The screen's content slides into place itself instead (AfterTransition).
          animation: Platform.OS === 'ios' ? 'ios_from_right' : 'none',
          animationDuration: 280,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      >
        <Stack.Screen name="AuthGate" component={AuthGateScreen} options={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
        <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: 'Sign in' }} />
        <Stack.Screen name="CreateAccount" component={CreateAccountScreen} options={{ title: 'Create an account' }} />
        <Stack.Screen name="GoogleSignIn" component={GoogleSignInScreen} options={{ title: 'Continue with Google' }} />
        <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
        <Stack.Screen name="PinLock" component={PinLockScreen} options={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
        <Stack.Screen name="Businesses" component={BusinessesScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false, animation: 'none', gestureEnabled: false }} />

        <Stack.Screen name="MenuGroup" component={MenuGroupScreen} options={{ title: 'Menu' }} />

        <Stack.Screen name="NewSale" component={NewSaleScreen} options={{ title: 'New sale' }} />
        <Stack.Screen name="Receipt" component={ReceiptScreen} options={{ title: 'Receipt' }} />
        <Stack.Screen name="Sales" component={SalesListScreen} options={{ title: 'Sales' }} />
        <Stack.Screen name="SaleDetail" component={SaleDetailScreen} options={{ title: 'Sale' }} />
        <Stack.Screen name="EditSale" component={EditSaleScreen} options={{ title: 'Edit sale' }} />
        <Stack.Screen name="Estimates" component={EstimatesScreen} options={{ title: 'Quotations' }} />
        <Stack.Screen name="EstimateNew" component={EstimateNewScreen} options={{ title: 'New quotation' }} />
        <Stack.Screen name="Challans" component={ChallansScreen} options={{ title: 'Delivery notes' }} />
        <Stack.Screen name="ChallanNew" component={ChallanNewScreen} options={{ title: 'New delivery note' }} />
        <Stack.Screen name="CreditNotes" component={CreditNotesScreen} options={{ title: 'Returns' }} />
        <Stack.Screen name="CreditNoteNew" component={CreditNoteNewScreen} options={{ title: 'Return goods' }} />
        <Stack.Screen name="Offers" component={OffersScreen} options={{ title: 'Offers' }} />
        <Stack.Screen name="OfferNew" component={OfferNewScreen} options={{ title: 'New offer' }} />
        <Stack.Screen name="Recurring" component={RecurringScreen} options={{ title: 'Recurring sales' }} />
        <Stack.Screen name="RecurringNew" component={RecurringNewScreen} options={{ title: 'New recurring sale' }} />
        <Stack.Screen name="Instalments" component={InstalmentsScreen} options={{ title: 'Instalment plans' }} />
        <Stack.Screen name="PlanDetail" component={PlanDetailScreen} options={{ title: 'Instalment plan' }} />
        <Stack.Screen name="PlanNew" component={PlanNewScreen} options={{ title: 'New plan' }} />

        <Stack.Screen name="Purchases" component={PurchasesScreen} options={{ title: 'Purchases' }} />
        <Stack.Screen name="PurchaseDetail" component={PurchaseDetailScreen} options={{ title: 'Purchase' }} />
        <Stack.Screen name="EditPurchase" component={EditPurchaseScreen} options={{ title: 'Edit purchase' }} />
        <Stack.Screen name="PurchaseNew" component={PurchaseNewScreen} options={{ title: 'New purchase' }} />
        <Stack.Screen name="PurchaseOrders" component={PurchaseOrdersScreen} options={{ title: 'Purchase orders' }} />
        <Stack.Screen name="PurchaseOrderNew" component={PurchaseOrderNewScreen} options={{ title: 'New purchase order' }} />

        <Stack.Screen name="Parties" component={PartiesScreen} options={{ title: 'Customers & suppliers' }} />
        <Stack.Screen name="PartyDetail" component={PartyDetailScreen} options={{ title: 'Party' }} />
        <Stack.Screen name="PartyEdit" component={PartyEditScreen} options={{ title: 'Contact details' }} />
        <Stack.Screen name="PartyLedger" component={PartyLedgerScreen} options={{ title: 'Ledger' }} />
        <Stack.Screen name="Loyalty" component={LoyaltyScreen} options={{ title: 'Loyalty' }} />
        <Stack.Screen name="UsersRoles" component={UsersRolesScreen} options={{ title: 'Users and roles' }} />

        <Stack.Screen name="ItemDetail" component={ItemDetailScreen} options={{ title: 'Item' }} />
        <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: 'Product' }} />
        <Stack.Screen name="StockAdjust" component={StockAdjustScreen} options={{ title: 'Adjust stock' }} />
        <Stack.Screen name="StockTransfer" component={StockTransferScreen} options={{ title: 'Move between stores' }} />
        <Stack.Screen name="Batches" component={BatchReportScreen} options={{ title: 'Batches & expiry' }} />
        <Stack.Screen name="StaffReport" component={StaffReportScreen} options={{ title: 'Staff performance' }} />
        <Stack.Screen name="BatchMovement" component={BatchMovementScreen} options={{ title: 'Batch movement' }} />
        <Stack.Screen name="PriceList" component={PriceListScreen} options={{ title: 'Price list' }} />
        <Stack.Screen name="NamesEditor" component={NamesEditorScreen} options={{ title: 'Names & descriptions' }} />
        <Stack.Screen name="ActivateItems" component={ActivateScreen} options={{ title: 'On sale / off sale' }} />
        <Stack.Screen name="PriceTags" component={PriceTagScreen} options={{ title: 'Price tags' }} />
        <Stack.Screen name="Branches" component={BranchesScreen} options={{ title: 'Branches' }} />
        <Stack.Screen name="Developer" component={DeveloperScreen} options={{ title: "Developer console" }} />
        <Stack.Screen name="NewBranch" component={NewBranchScreen} options={{ title: "Open a branch" }} />
        <Stack.Screen name="BranchAnalysis" component={BranchAnalysisScreen} options={{ title: 'Branch analysis' }} />
        <Stack.Screen name="AccountingHub" component={AccountingHubScreen} options={{ title: 'Accounting' }} />
        <Stack.Screen name="Reconciliation" component={ReconciliationScreen} options={{ title: 'Bank reconciliation' }} />
        <Stack.Screen name="ChartOfAccounts" component={ChartOfAccountsScreen} options={{ title: 'Chart of accounts' }} />
        <Stack.Screen name="LedgerDetail" component={LedgerDetailScreen} options={{ title: 'Ledger' }} />
        <Stack.Screen name="JournalEntry" component={JournalEntryScreen} options={{ title: 'New journal entry' }} />
        <Stack.Screen name="TrialBalance" component={TrialBalanceScreen} options={{ title: 'Trial balance' }} />
        <Stack.Screen name="StockTakes" component={StockTakesScreen} options={{ title: 'Stock take' }} />
        <Stack.Screen name="StockTakeDetail" component={StockTakeDetailScreen} options={{ title: 'Stock take' }} />
        <Stack.Screen name="Production" component={ProductionScreen} options={{ title: 'Production' }} />
        <Stack.Screen name="Warranties" component={WarrantiesScreen} options={{ title: 'Warranty' }} />
        <Stack.Screen name="UnitsCategories" component={UnitsCategoriesScreen} options={{ title: 'Units & categories' }} />
        <Stack.Screen name="BulkChange" component={BulkChangeScreen} options={{ title: 'Bulk change' }} />
        <Stack.Screen name="BulkPreview" component={BulkPreviewScreen} options={{ title: 'Check the changes' }} />

        <Stack.Screen name="Money" component={MoneyScreen} options={{ title: 'Cash & bank' }} />
        <Stack.Screen name="AccountDetail" component={AccountDetailScreen} options={{ title: 'Account' }} />
        <Stack.Screen name="PaymentNew" component={PaymentNewScreen} options={{ title: 'Record payment' }} />
        <Stack.Screen name="PaymentDetail" component={PaymentDetailScreen} options={{ title: 'Payment' }} />
        <Stack.Screen name="EntryNew" component={EntryNewScreen} options={{ title: 'Adjust Money' }} />
        <Stack.Screen name="CashEntries" component={CashEntriesScreen} options={{ title: 'Cash in' }} />
        <Stack.Screen name="Transfer" component={TransferScreen} options={{ title: 'Move money' }} />
        <Stack.Screen name="Accounting" component={AccountingScreen} options={{ title: 'Accounting' }} />
        <Stack.Screen name="Journals" component={JournalsScreen} options={{ title: 'Journal entries' }} />
        <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
        <Stack.Screen name="ReportDetail" component={ReportDetailScreen} options={{ title: 'Report' }} />
        <Stack.Screen name="Tax" component={TaxScreen} options={{ title: 'Tax & URA' }} />

        <Stack.Screen name="Shift" component={ShiftScreen} options={{ title: 'Shifts & day close' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        <Stack.Screen name="Printing" component={PrintingScreen} options={{ title: 'Printing' }} />
        <Stack.Screen name="PrintingReceipt" component={ReceiptSettingsScreen} options={{ title: 'Receipt settings' }} />
        <Stack.Screen name="PrintingInvoice" component={InvoiceSettingsScreen} options={{ title: 'Invoice settings' }} />
        <Stack.Screen name="Help" component={HelpScreen} options={{ title: 'Help & about' }} />
        <Stack.Screen name="Faq" component={FaqScreen} options={{ title: 'FAQs & help' }} />
        <Stack.Screen name="Legal" component={LegalScreen} options={({ route }: any) => ({ title: route.params?.doc === 'privacy' ? 'Privacy policy' : route.params?.doc === 'terms' ? 'Terms and conditions' : 'Legal' })} />
        <Stack.Screen name="DataTools" component={DataToolsScreen} options={{ title: 'Data tools' }} />
        <Stack.Screen name="VyaparImport" component={VyaparImportScreen} options={{ title: 'Move from Vyapar' }} />
        <Stack.Screen name="ReminderSettings" component={ReminderSettingsScreen} options={{ title: 'Payment reminders' }} />
        <Stack.Screen name="Business" component={BusinessScreen} options={{ title: 'Business & branches' }} />
        <Stack.Screen name="Firms" component={FirmsScreen} options={{ title: 'Businesses' }} />
        <Stack.Screen name="AuditLog" component={AuditLogScreen} options={{ title: 'Audit log' }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
        <Stack.Screen name="Plans" component={LicenceScreen} options={{ title: 'Plan & licence' }} />
        <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
        <Stack.Screen name="Licence" component={LicenceScreen} options={{ title: 'Plan & licence' }} />
        <Stack.Screen name="LicenceStop" component={LicenceStopScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Sync" component={SyncScreen} options={{ title: 'Cloud sync' }} />
        <Stack.Screen name="Online" component={OnlineScreen} options={{ title: 'Online mode' }} />
        <Stack.Screen name="Versions" component={VersionsScreen} options={{ title: 'History' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
