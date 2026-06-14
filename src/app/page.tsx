'use client';

import React, { useState, useEffect } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
}

interface Group {
  id: string;
  name: string;
  memberships: {
    id: string;
    joinedAt: string;
    leftAt: string | null;
    user: User;
  }[];
}

interface Expense {
  id: string;
  description: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  paidBy: { id: string; name: string };
  date: string;
  splitType: string;
  splits: {
    id: string;
    userId: string;
    amount: number;
    user: { name: string };
  }[];
}

interface Settlement {
  id: string;
  amount: number;
  currency: string;
  date: string;
  payer: { id: string; name: string };
  payee: { id: string; name: string };
}

interface Anomaly {
  id: string;
  importLogId: string;
  rowNumber: number;
  columnName: string | null;
  rawValue: string | null;
  errorType: string;
  description: string;
  resolutionPolicy: string | null;
  status: string;
}

interface LedgerItem {
  type: 'PAYMENT' | 'SHARE' | 'SETTLEMENT_SENT' | 'SETTLEMENT_RECV';
  description: string;
  amount: number;
  currency: string;
  baseAmount: number;
  date: string;
}

interface UserSummary {
  userId: string;
  name: string;
  totalPaid: number;
  totalOwed: number;
  totalSettledSent: number;
  totalSettledRecv: number;
  netBalance: number;
  ledger: LedgerItem[];
}

interface DebtPayment {
  from: { id: string; name: string };
  to: { id: string; name: string };
  amount: number;
}

interface GroupSummary {
  members: { id: string; name: string; balance: number }[];
  userSummary: UserSummary[];
  simplifiedPayments: DebtPayment[];
}

export default function Home() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [summary, setSummary] = useState<GroupSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'expenses' | 'settlements' | 'importer'>('dashboard');

  // Form states
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [exchangeRate, setExchangeRate] = useState('1.0');
  const [splitType, setSplitType] = useState('EQUAL');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);

  // CSV Importer state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [importLogId, setImportLogId] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [resolvedRows, setResolvedRows] = useState<any[]>([]);
  const [csvPreviewRows, setCsvPreviewRows] = useState<any[]>([]);
  const [isImportComplete, setIsImportComplete] = useState(false);
  const [usdRate, setUsdRate] = useState<number>(83.0); // Priya's Conversion rate parameter
  const [resolutionsMap, setResolutionsMap] = useState<Record<string, { action: string; param?: string }>>({});

  // 1. Initial Load
  useEffect(() => {
    // Check local storage for logged-in user
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
      setCurrentUser(JSON.parse(savedUser));
    }

    // Load groups and summary
    fetchGroupsAndUsers();
  }, []);

  useEffect(() => {
    if (selectedGroupId) {
      fetchSummaryAndData(selectedGroupId);
    }
  }, [selectedGroupId]);

  const fetchGroupsAndUsers = async () => {
    try {
      const gRes = await fetch('/api/groups');
      const gData = await gRes.json();
      setGroups(gData);
      if (gData.length > 0) {
        setSelectedGroupId(gData[0].id);
      }

      // Collect all unique users from memberships
      const allUsers: User[] = [];
      const userIds = new Set<string>();
      gData.forEach((g: Group) => {
        g.memberships.forEach(m => {
          if (!userIds.has(m.user.id)) {
            userIds.add(m.user.id);
            allUsers.push(m.user);
          }
        });
      });
      setUsers(allUsers);
    } catch (err) {
      console.error('Failed to load groups:', err);
    }
  };

  const fetchSummaryAndData = async (groupId: string) => {
    try {
      const sRes = await fetch(`/api/groups/summary?groupId=${groupId}`);
      const sData = await sRes.json();
      setSummary(sData);

      const eRes = await fetch(`/api/expenses?groupId=${groupId}`);
      const eData = await eRes.json();
      setExpenses(eData);

      const stRes = await fetch(`/api/settlements?groupId=${groupId}`);
      const stData = await stRes.json();
      setSettlements(stData);
    } catch (err) {
      console.error('Failed to load summary details:', err);
    }
  };

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('currentUser');
  };

  // Add Manual Expense
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !selectedGroupId) return;

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: selectedGroupId,
          description,
          amount,
          currency,
          exchangeRate,
          paidById: currentUser.id,
          date: expenseDate,
          splitType,
        }),
      });

      if (res.ok) {
        setIsAddExpenseOpen(false);
        setDescription('');
        setAmount('');
        setCurrency('INR');
        setExchangeRate('1.0');
        setSplitType('EQUAL');
        fetchSummaryAndData(selectedGroupId);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add expense');
      }
    } catch (err) {
      console.error(err);
      alert('Error creating expense');
    }
  };

  // Record Settlement Payment
  const handleRecordSettlement = async (payerId: string, payeeId: string, amount: number) => {
    if (!selectedGroupId) return;
    try {
      const res = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: selectedGroupId,
          payerId,
          payeeId,
          amount,
          currency: 'INR',
          date: new Date().toISOString(),
        }),
      });

      if (res.ok) {
        fetchSummaryAndData(selectedGroupId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // CSV File Ingestion Upload
  const handleCSVUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile || !selectedGroupId) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', csvFile);
    formData.append('groupId', selectedGroupId);

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setImportLogId(data.importLogId);
        setAnomalies(data.anomalies);
        setIsImportComplete(false);

        // Read file contents locally for staging preview and adjustments
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          // Simple local parsing to bind with anomalies
          const lines = text.split(/\r?\n/);
          const parsedLines = [];
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const values = line.split(',');
            const rowData: Record<string, string> = {};
            headers.forEach((h, idx) => {
              rowData[h] = values[idx] || '';
            });
            parsedLines.push({
              index: i + 1,
              ...rowData,
            });
          }
          setCsvPreviewRows(parsedLines);

          // Initialise default resolutions map
          const initResolutions: Record<string, { action: string; param?: string }> = {};
          data.anomalies.forEach((a: Anomaly) => {
            // Pick default policy
            const defaultPolicy = a.resolutionPolicy?.split('|')[0] || 'RESOLVE';
            const defaultParam = a.resolutionPolicy?.split('|')[1] || '';
            initResolutions[a.id] = { action: defaultPolicy, param: defaultParam };
          });
          setResolutionsMap(initResolutions);
        };
        reader.readAsText(csvFile);
      } else {
        alert(data.error || 'Failed to process CSV file');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
    }
  };

  // Modify individual anomaly resolution choices
  const updateResolution = (anomalyId: string, action: string, param?: string) => {
    setResolutionsMap(prev => ({
      ...prev,
      [anomalyId]: { action, param },
    }));
  };

  // Submit manual anomaly resolutions & commit entries to database (Meera's Request)
  const handleResolveAndSubmit = async () => {
    if (!selectedGroupId || !importLogId || !summary) return;

    // Build the resolved rows list to commit
    const processedRows: any[] = [];
    const resolutionsLogList: any[] = [];

    // Group memberships mappings for active checks
    const memberships = groups.find(g => g.id === selectedGroupId)?.memberships || [];
    const memberMap = new Map(memberships.map(m => [m.user.name.toLowerCase(), m]));
    const userDbMap = new Map(memberships.map(m => [m.user.name.toLowerCase(), m.user]));

    // Track duplicate hashes during resolve pass
    const processedHashes = new Set<string>();

    for (let i = 0; i < csvPreviewRows.length; i++) {
      const row = csvPreviewRows[i];
      const rowNum = row.index;

      // Find anomalies belonging to this row
      const rowAnomalies = anomalies.filter(a => a.rowNumber === rowNum);
      
      let discardRow = false;
      let isDuplicate = false;
      let isSettlement = false;
      let forceAbs = false;
      let currencyStr = (row.currency || 'INR').trim().toUpperCase();
      let rate = currencyStr === 'USD' ? usdRate : 1.0;
      let dateStr = row.date;
      let rawPayerName = row.paidby;
      let rawAmount = row.amount;
      let excludeMembersSet = new Set<string>();

      // Read resolutions
      for (const a of rowAnomalies) {
        const res = resolutionsMap[a.id];
        if (!res) continue;

        resolutionsLogList.push({
          anomalyId: a.id,
          policy: `${res.action}${res.param ? '|' + res.param : ''}`,
          status: 'RESOLVED',
        });

        if (res.action === 'DISCARD_ROW') {
          discardRow = true;
        } else if (res.action === 'PENDING_APPROVAL_DELETE') {
          // If Meera decided to delete the duplicate (Skip duplicate)
          discardRow = true;
        } else if (res.action === 'KEEP_DUPLICATE' || res.action === 'IGNORE') {
          // Keep it
        } else if (res.action === 'AUTO_CORRECT_DATE' && res.param) {
          dateStr = res.param;
        } else if (res.action === 'AUTO_CORRECT_ABS') {
          forceAbs = true;
        } else if (res.action === 'CONVERT_USD_INR') {
          rate = usdRate;
        } else if (res.action === 'CONVERT_TO_SETTLEMENT') {
          isSettlement = true;
        } else if (res.action === 'AUTO_TRIM_NAME' && res.param) {
          rawPayerName = res.param;
        } else if (res.action === 'EXCLUDE_MEMBER_SPLIT' && res.param) {
          excludeMembersSet.add(res.param.toLowerCase());
        }
      }

      if (discardRow) continue;

      // Clean up values
      const payerNameClean = rawPayerName.trim();
      const payerUser = userDbMap.get(payerNameClean.toLowerCase());
      if (!payerUser) continue; // Unknown payer can't be mapped

      let parsedAmount = parseFloat(rawAmount.replace(/,/g, ''));
      if (isNaN(parsedAmount)) continue;
      if (forceAbs) parsedAmount = Math.abs(parsedAmount);

      const baseAmount = parsedAmount * rate;

      // Check duplicate hash again during resolution
      const hash = `${dateStr}|${row.description.trim().toLowerCase()}|${parsedAmount}|${payerNameClean.toLowerCase()}`;
      if (processedHashes.has(hash)) {
        // If it's a duplicate and duplicate resolution was not "KEEP_DUPLICATE", skip it
        const hasKeepResolution = rowAnomalies.some(a => a.errorType === 'DUPLICATE' && resolutionsMap[a.id]?.action === 'KEEP_DUPLICATE');
        if (!hasKeepResolution) continue;
      }
      processedHashes.add(hash);

      if (isSettlement) {
        // Direct settlement from payer to payee
        const payeeName = row.sharedwith.trim();
        const payeeUser = userDbMap.get(payeeName.toLowerCase());
        if (payeeUser) {
          processedRows.push({
            rowNumber: rowNum,
            date: dateStr,
            description: row.description,
            amount: parsedAmount,
            currency: currencyStr,
            exchangeRate: rate,
            paidById: payerUser.id,
            isSettlement: true,
            settlementPayeeId: payeeUser.id,
          });
        }
      } else {
        // regular shared expense split
        // Gather active split users on this expense date
        const expDate = new Date(dateStr);
        const activeMembers = memberships.filter(m => {
          const joined = new Date(m.joinedAt);
          const left = m.leftAt ? new Date(m.leftAt) : null;
          return expDate >= joined && (left === null || expDate <= left);
        }).map(m => m.user);

        // Resolve split list
        let splitUserNames: string[] = [];
        if (row.sharedwith) {
          splitUserNames = row.sharedwith.split(';').map((n: string) => n.trim().toLowerCase());
        } else {
          // If blank, default split to all active members
          splitUserNames = activeMembers.map(u => u.name.toLowerCase());
        }

        // Apply filters: exclude users marked for exclusion (Sam/Meera/Dev temporal exclusions)
        const finalSplitUsers = activeMembers.filter(u => {
          const isExplicitSplit = splitUserNames.includes(u.name.toLowerCase());
          const isExcluded = excludeMembersSet.has(u.name.toLowerCase());
          return isExplicitSplit && !isExcluded;
        });

        if (finalSplitUsers.length === 0) continue; // Skip if no split members

        const shareAmount = parseFloat((baseAmount / finalSplitUsers.length).toFixed(2));

        processedRows.push({
          rowNumber: rowNum,
          date: dateStr,
          description: row.description,
          amount: parsedAmount,
          currency: currencyStr,
          exchangeRate: rate,
          paidById: payerUser.id,
          splitType: 'EQUAL',
          splits: finalSplitUsers.map(u => ({
            userId: u.id,
            amount: shareAmount,
          })),
        });
      }
    }

    try {
      const res = await fetch('/api/import/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: selectedGroupId,
          importLogId,
          resolvedRows: processedRows,
          resolutions: resolutionsLogList,
        }),
      });

      if (res.ok) {
        setIsImportComplete(true);
        setAnomalies([]);
        setCsvFile(null);
        fetchSummaryAndData(selectedGroupId);
      } else {
        alert('Failed to apply resolutions');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Login View
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-tr from-violet-950 via-zinc-900 to-indigo-950 flex flex-col justify-center items-center p-6 text-zinc-50">
        <div className="bg-zinc-900/60 backdrop-blur-lg border border-zinc-800 p-8 rounded-2xl max-w-md w-full shadow-2xl text-center">
          <div className="mb-6 flex justify-center">
            <div className="w-16 h-16 bg-gradient-to-r from-violet-500 to-indigo-500 rounded-2xl flex items-center justify-center font-bold text-2xl tracking-wide shadow-lg">
              S
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight mb-2 bg-gradient-to-r from-violet-400 to-indigo-300 bg-clip-text text-transparent">
            SplitShare
          </h1>
          <p className="text-zinc-400 text-sm mb-8">
            Roommate Expense Splitter & Anomaly Importer
          </p>

          <h3 className="text-lg font-semibold mb-4 text-left">Log in as a Flatmate</h3>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {['Aisha', 'Rohan', 'Priya', 'Meera', 'Dev', 'Sam'].map(name => {
              const u = users.find(u => u.name.toLowerCase() === name.toLowerCase());
              const defaultEmail = `${name.toLowerCase()}@splitshare.com`;
              return (
                <button
                  key={name}
                  onClick={() => handleLogin(u || { id: name, name, email: defaultEmail })}
                  className="bg-zinc-800/50 hover:bg-violet-600/40 border border-zinc-700/60 hover:border-violet-500 py-3 px-4 rounded-xl font-medium text-sm transition-all duration-200"
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const currentUserSummary = summary?.userSummary.find(s => s.userId === currentUser.id);
  const userBalance = currentUserSummary?.netBalance || 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans flex flex-col">
      {/* Premium Glass Header */}
      <header className="bg-zinc-900/60 backdrop-blur-md border-b border-zinc-800/80 sticky top-0 z-40 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-r from-violet-500 to-indigo-500 rounded-xl flex items-center justify-center font-extrabold text-lg shadow-md">
            S
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">SplitShare</h1>
            <p className="text-xs text-zinc-500">Flatmates Group Expenses</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex gap-1 bg-zinc-950/80 border border-zinc-800 p-1 rounded-xl">
            {(['dashboard', 'expenses', 'settlements', 'importer'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeTab === tab ? 'bg-zinc-800 text-zinc-50 shadow' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold text-zinc-200">{currentUser.name}</p>
              <p className="text-xs text-zinc-500">{currentUser.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="bg-zinc-800/50 hover:bg-red-950/40 hover:text-red-400 border border-zinc-700/60 hover:border-red-900 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Grid View */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 flex flex-col gap-6">
        {/* Mobile Nav */}
        <div className="md:hidden flex justify-around bg-zinc-900 border border-zinc-800 p-1.5 rounded-xl">
          {(['dashboard', 'expenses', 'settlements', 'importer'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                activeTab === tab ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Stat Cards */}
            <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-zinc-900/40 backdrop-blur border border-zinc-800/80 p-5 rounded-2xl flex flex-col justify-between h-32">
                <span className="text-zinc-500 text-sm font-semibold">Your Status</span>
                <span className={`text-3xl font-extrabold ${userBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {userBalance >= 0 ? `+ ₹${userBalance}` : `- ₹${Math.abs(userBalance)}`}
                </span>
                <span className="text-zinc-500 text-xs">
                  {userBalance >= 0 ? 'You are owed money overall' : 'You owe money overall'}
                </span>
              </div>
              <div className="bg-zinc-900/40 backdrop-blur border border-zinc-800/80 p-5 rounded-2xl flex flex-col justify-between h-32">
                <span className="text-zinc-500 text-sm font-semibold">Total Paid</span>
                <span className="text-3xl font-extrabold text-indigo-400">
                  ₹{currentUserSummary?.totalPaid || 0}
                </span>
                <span className="text-zinc-500 text-xs">Your absolute payment contributions</span>
              </div>
              <div className="bg-zinc-900/40 backdrop-blur border border-zinc-800/80 p-5 rounded-2xl flex flex-col justify-between h-32">
                <span className="text-zinc-500 text-sm font-semibold">Total Share Owed</span>
                <span className="text-3xl font-extrabold text-violet-400">
                  ₹{currentUserSummary?.totalOwed || 0}
                </span>
                <span className="text-zinc-500 text-xs">Your absolute consumption share</span>
              </div>
            </div>

            {/* Aisha's Minimized Debt Settlements Panel */}
            <div className="bg-zinc-900/40 backdrop-blur border border-zinc-800/80 p-6 rounded-2xl md:col-span-2 flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-lg font-bold tracking-tight">Debt Minimization Summary</h3>
                  <p className="text-xs text-zinc-500">Graph-based minimized transactions (Aisha's Request)</p>
                </div>
                <button
                  onClick={() => setIsAddExpenseOpen(true)}
                  className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 py-2 px-4 rounded-xl text-xs font-bold transition-all shadow-md"
                >
                  + Add Expense
                </button>
              </div>

              <div className="flex-1 flex flex-col gap-3">
                {summary && summary.simplifiedPayments.length > 0 ? (
                  summary.simplifiedPayments.map((p, idx) => (
                    <div
                      key={idx}
                      className="bg-zinc-950/60 border border-zinc-800/50 p-4 rounded-xl flex justify-between items-center hover:border-violet-500/30 transition-all duration-200"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-rose-300 text-sm">{p.from.name}</span>
                        <span className="text-zinc-600 text-xs">pays</span>
                        <span className="font-semibold text-emerald-300 text-sm">{p.to.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-extrabold text-sm text-zinc-100">₹{p.amount}</span>
                        {(currentUser.id === p.from.id || currentUser.id === p.to.id) && (
                          <button
                            onClick={() => handleRecordSettlement(p.from.id, p.to.id, p.amount)}
                            className="bg-violet-600/20 hover:bg-violet-600 hover:text-white border border-violet-500/30 text-violet-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200"
                          >
                            Mark Settled
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-sm py-8">
                    No active balances to settle up. The group is fully balanced!
                  </div>
                )}
              </div>
            </div>

            {/* Rohan's Traceability Panel */}
            <div className="bg-zinc-900/40 backdrop-blur border border-zinc-800/80 p-6 rounded-2xl flex flex-col">
              <h3 className="text-lg font-bold tracking-tight mb-2">Ledger Breakdown</h3>
              <p className="text-xs text-zinc-500 mb-6">Fully transparent list of your splits (Rohan's Request)</p>

              <div className="flex-1 overflow-y-auto max-h-[350px] flex flex-col gap-3 pr-2">
                {currentUserSummary && currentUserSummary.ledger.length > 0 ? (
                  currentUserSummary.ledger.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-zinc-950/40 border border-zinc-800/40 p-3 rounded-lg flex flex-col justify-between gap-1.5 hover:border-zinc-700/60 transition-all duration-150"
                    >
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-semibold text-zinc-200 truncate max-w-[150px]">
                          {item.description}
                        </span>
                        <span
                          className={`text-xs font-extrabold ${
                            item.type === 'PAYMENT' || item.type === 'SETTLEMENT_SENT'
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {item.type === 'PAYMENT' || item.type === 'SETTLEMENT_SENT' ? '+' : '-'} ₹
                          {item.baseAmount.toFixed(0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] text-zinc-500">
                        <span>{new Date(item.date).toLocaleDateString()}</span>
                        {item.currency !== 'INR' && (
                          <span>
                            Original: {item.currency === 'USD' ? '$' : ''}
                            {item.amount.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs text-center py-8">
                    No transactions recorded.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Expenses Tab */}
        {activeTab === 'expenses' && (
          <div className="bg-zinc-900/40 backdrop-blur border border-zinc-800/80 p-6 rounded-2xl">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-bold tracking-tight">Expenses</h3>
                <p className="text-xs text-zinc-500">Detailed list of group expenses</p>
              </div>
              <button
                onClick={() => setIsAddExpenseOpen(true)}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 py-2 px-4 rounded-xl text-xs font-bold transition-all"
              >
                + Add Expense
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-zinc-300">
                <thead className="bg-zinc-950/60 text-zinc-400 uppercase text-xs border-b border-zinc-800">
                  <tr>
                    <th className="py-3.5 px-4 font-semibold">Date</th>
                    <th className="py-3.5 px-4 font-semibold">Description</th>
                    <th className="py-3.5 px-4 font-semibold">Paid By</th>
                    <th className="py-3.5 px-4 font-semibold">Split Type</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {expenses.length > 0 ? (
                    expenses.map(exp => (
                      <tr key={exp.id} className="hover:bg-zinc-850/20 transition-all">
                        <td className="py-4 px-4">{new Date(exp.date).toLocaleDateString()}</td>
                        <td className="py-4 px-4 font-medium text-zinc-100">
                          <div>{exp.description}</div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            Splits: {exp.splits.map(s => `${s.user.name} (₹${s.amount.toFixed(0)})`).join(', ')}
                          </div>
                        </td>
                        <td className="py-4 px-4">{exp.paidBy.name}</td>
                        <td className="py-4 px-4 text-xs font-semibold text-zinc-400">{exp.splitType}</td>
                        <td className="py-4 px-4 text-right font-bold text-zinc-100">
                          {exp.currency === 'USD' ? `$${exp.amount}` : `₹${exp.amount}`}
                          {exp.currency !== 'INR' && (
                            <span className="block text-[10px] text-zinc-500 font-normal">
                              Converted: ₹{(exp.amount * exp.exchangeRate).toFixed(0)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-zinc-500">
                        No expenses found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Settlements Tab */}
        {activeTab === 'settlements' && (
          <div className="bg-zinc-900/40 backdrop-blur border border-zinc-800/80 p-6 rounded-2xl">
            <h3 className="text-lg font-bold tracking-tight mb-2">Direct Payments & Settlements</h3>
            <p className="text-xs text-zinc-500 mb-6">Logs of recorded roommates balance pay-offs</p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-zinc-300">
                <thead className="bg-zinc-950/60 text-zinc-400 uppercase text-xs border-b border-zinc-800">
                  <tr>
                    <th className="py-3.5 px-4 font-semibold">Date</th>
                    <th className="py-3.5 px-4 font-semibold">Payer (Who Paid)</th>
                    <th className="py-3.5 px-4 font-semibold">Payee (Received)</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {settlements.length > 0 ? (
                    settlements.map(set => (
                      <tr key={set.id} className="hover:bg-zinc-850/20 transition-all">
                        <td className="py-4 px-4">{new Date(set.date).toLocaleDateString()}</td>
                        <td className="py-4 px-4 font-medium text-rose-300">{set.payer.name}</td>
                        <td className="py-4 px-4 font-medium text-emerald-300">{set.payee.name}</td>
                        <td className="py-4 px-4 text-right font-extrabold text-zinc-100">₹{set.amount}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-zinc-500">
                        No settlements found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CSV Importer Tab */}
        {activeTab === 'importer' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Upload form */}
            <div className="bg-zinc-900/40 backdrop-blur border border-zinc-800/80 p-6 rounded-2xl flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold tracking-tight mb-2">CSV Importer</h3>
                <p className="text-xs text-zinc-500 mb-6">
                  Select and parse raw roommates transaction logs directly.
                </p>
                
                <form onSubmit={handleCSVUpload} className="flex flex-col gap-4">
                  <div className="border-2 border-dashed border-zinc-700/60 hover:border-violet-500/60 bg-zinc-950/40 p-8 rounded-xl text-center cursor-pointer transition-all">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                      className="hidden"
                      id="csv-file-input"
                    />
                    <label htmlFor="csv-file-input" className="cursor-pointer block">
                      <span className="block font-semibold text-zinc-300 text-sm mb-1">
                        {csvFile ? csvFile.name : 'Select expenses_export.csv'}
                      </span>
                      <span className="block text-zinc-500 text-xs">CSV files only</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={!csvFile || isUploading}
                    className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white py-3 rounded-xl font-bold transition-all shadow-md disabled:opacity-50"
                  >
                    {isUploading ? 'Parsing...' : 'Analyze CSV & Log Anomalies'}
                  </button>
                </form>
              </div>

              {isImportComplete && (
                <div className="bg-emerald-950/20 border border-emerald-900/40 text-emerald-400 p-4 rounded-xl text-xs font-semibold mt-6">
                  ✓ Import complete! Data was processed and committed to the database. All anomaly resolutions applied.
                </div>
              )}
            </div>

            {/* Meera's CSV Anomaly Review Panel */}
            <div className="lg:col-span-2 bg-zinc-900/40 backdrop-blur border border-zinc-800/80 p-6 rounded-2xl flex flex-col h-[500px]">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-lg font-bold tracking-tight">Anomaly Resolution Pipeline</h3>
                  <p className="text-xs text-zinc-500">Surfaces the CSV data problems (Meera's Request)</p>
                </div>
                {anomalies.length > 0 && (
                  <button
                    onClick={handleResolveAndSubmit}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-4 rounded-xl text-xs font-bold transition-all shadow-md"
                  >
                    Apply Resolutions & Commit Import
                  </button>
                )}
              </div>

              {/* Anomaly wizard */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-2">
                {anomalies.length > 0 ? (
                  <div className="mb-4">
                    {/* USD Exchange Rate parameter controller (Priya's request) */}
                    {anomalies.some(a => a.errorType === 'CURRENCY_USD') && (
                      <div className="bg-zinc-950/60 border border-zinc-800 p-4 rounded-xl flex justify-between items-center mb-4">
                        <div>
                          <span className="block text-xs font-bold text-zinc-300">Priya's USD Exchange Rate</span>
                          <span className="text-[10px] text-zinc-500">Set conversion value (e.g. 1 USD = 83 INR)</span>
                        </div>
                        <input
                          type="number"
                          value={usdRate}
                          onChange={(e) => setUsdRate(parseFloat(e.target.value) || 83)}
                          className="bg-zinc-900 border border-zinc-700 px-3 py-1.5 rounded-lg text-sm font-bold text-indigo-400 w-24 text-right"
                        />
                      </div>
                    )}

                    <div className="flex flex-col gap-3">
                      {anomalies.map((a) => (
                        <div
                          key={a.id}
                          className="bg-zinc-950/50 border border-zinc-800/80 p-4 rounded-xl flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:border-amber-500/20 transition-all duration-200"
                        >
                          <div className="max-w-[70%]">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] font-bold">
                                Row {a.rowNumber}
                              </span>
                              <span className="text-zinc-300 text-xs font-semibold">{a.errorType}</span>
                            </div>
                            <p className="text-xs text-zinc-400">{a.description}</p>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Resolution Selector Choice */}
                            {a.errorType === 'DUPLICATE' && (
                              <select
                                value={resolutionsMap[a.id]?.action}
                                onChange={(e) => updateResolution(a.id, e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 text-zinc-300 py-1.5 px-3 rounded-lg text-xs font-semibold"
                              >
                                <option value="PENDING_APPROVAL_DELETE">Skip Duplicate (Discard)</option>
                                <option value="KEEP_DUPLICATE">Keep Duplicate</option>
                              </select>
                            )}

                            {a.errorType === 'NEGATIVE_AMOUNT' && (
                              <select
                                value={resolutionsMap[a.id]?.action}
                                onChange={(e) => updateResolution(a.id, e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 text-zinc-300 py-1.5 px-3 rounded-lg text-xs font-semibold"
                              >
                                <option value="AUTO_CORRECT_ABS">Convert to Positive Value</option>
                                <option value="DISCARD_ROW">Discard Row</option>
                              </select>
                            )}

                            {a.errorType === 'CURRENCY_USD' && (
                              <span className="text-xs font-semibold text-indigo-400 bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20">
                                Converted at ₹{usdRate}
                              </span>
                            )}

                            {a.errorType === 'SETTLEMENT_LOGGED_AS_EXPENSE' && (
                              <select
                                value={resolutionsMap[a.id]?.action}
                                onChange={(e) => updateResolution(a.id, e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 text-zinc-300 py-1.5 px-3 rounded-lg text-xs font-semibold"
                              >
                                <option value="CONVERT_TO_SETTLEMENT">Record as Settlement</option>
                                <option value="DISCARD_ROW">Discard Row</option>
                              </select>
                            )}

                            {a.errorType.startsWith('TEMPORAL_MEMBERSHIP_') && (
                              <select
                                value={resolutionsMap[a.id]?.action}
                                onChange={(e) => updateResolution(a.id, e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 text-zinc-300 py-1.5 px-3 rounded-lg text-xs font-semibold"
                              >
                                <option value={a.resolutionPolicy || 'EXCLUDE_MEMBER_SPLIT'}>Exclude from Split</option>
                                <option value="IGNORE">Force split anyway</option>
                              </select>
                            )}

                            {a.errorType === 'INCONSISTENT_NAME_WHITESPACE' && (
                              <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                                Normalizing name
                              </span>
                            )}

                            {a.errorType === 'SPLIT_SHARE_MISMATCH' && (
                              <select
                                value={resolutionsMap[a.id]?.action}
                                onChange={(e) => updateResolution(a.id, e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 text-zinc-300 py-1.5 px-3 rounded-lg text-xs font-semibold"
                              >
                                <option value="REDISTRIBUTE_EQUAL_PERCENTAGE">Split Equally</option>
                                <option value="DISCARD_ROW">Discard Row</option>
                              </select>
                            )}

                            {a.errorType === 'INVALID_AMOUNT' && (
                              <span className="text-xs font-semibold text-rose-400 bg-rose-500/10 px-3 py-1.5 rounded-lg border border-rose-500/20">
                                Discarding row
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-xs py-8 text-center">
                    Upload a CSV file to inspect data anomalies.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Add Manual Expense Modal */}
      {isAddExpenseOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-6">
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl max-w-md w-full shadow-2xl flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-bold tracking-tight">Create Shared Expense</h3>
              <p className="text-xs text-zinc-500">Record a new shared expense for the flatmates</p>
            </div>

            <form onSubmit={handleAddExpense} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-400 font-semibold">Description</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Rent, Electricity, Dinner, etc."
                  className="bg-zinc-950 border border-zinc-850 py-2.5 px-3.5 rounded-xl text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400 font-semibold">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Total amount"
                    className="bg-zinc-950 border border-zinc-850 py-2.5 px-3.5 rounded-xl text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400 font-semibold">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      if (e.target.value === 'INR') setExchangeRate('1.0');
                    }}
                    className="bg-zinc-950 border border-zinc-850 py-2.5 px-3.5 rounded-xl text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              {currency === 'USD' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400 font-semibold">Exchange Rate (1 USD to INR)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(e.target.value)}
                    placeholder="e.g. 83.5"
                    className="bg-zinc-950 border border-zinc-850 py-2.5 px-3.5 rounded-xl text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400 font-semibold">Split Strategy</label>
                  <select
                    value={splitType}
                    onChange={(e) => setSplitType(e.target.value)}
                    className="bg-zinc-950 border border-zinc-850 py-2.5 px-3.5 rounded-xl text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  >
                    <option value="EQUAL">Equal Split</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-zinc-400 font-semibold">Date</label>
                  <input
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="bg-zinc-950 border border-zinc-850 py-2.5 px-3.5 rounded-xl text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setIsAddExpenseOpen(false)}
                  className="w-1/2 bg-zinc-850 hover:bg-zinc-800 border border-zinc-700/60 py-2.5 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white py-2.5 rounded-xl text-xs font-bold transition-all shadow-md"
                >
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
