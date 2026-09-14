import React, { useState, useEffect, useMemo } from 'react';
import { 
  Play, CheckCircle2, AlertTriangle, Clock, Calendar, Sparkles, 
  Plus, Settings, PieChart, Layers, ShieldAlert, ArrowRight, 
  RotateCcw, Bell, Moon, Sun, Trash2, Edit3, Check, RefreshCw, ChevronRight, X
} from 'lucide-react';

// --- TYPES & INTERFACES ---
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Task {
  id: string;
  title: string;
  startTime: string; // "HH:MM" 24h format
  durationMinutes: number;
  priority: Priority;
  completed: boolean;
  project: string;
  recurring?: 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'NONE';
  deadline?: string; // "HH:MM"
}

export interface UserSettings {
  dayStartTime: string; // "08:00"
  bedTime: string;      // "23:00"
  notificationsEnabled: boolean;
  defaultDuration: number;
}

// --- INITIAL SEED DATA ---
const INITIAL_TASKS: Task[] = [
  {
    id: '1',
    title: 'Review neck fasciae & topographic anatomy',
    startTime: '10:40',
    durationMinutes: 90,
    priority: 'HIGH',
    completed: false,
    project: 'University'
  },
  {
    id: '2',
    title: 'Epidemiology: 10 key definitions',
    startTime: '14:00',
    durationMinutes: 45,
    priority: 'HIGH',
    completed: false,
    project: 'University'
  },
  {
    id: '3',
    title: '30-minute cardio walk',
    startTime: '18:30',
    durationMinutes: 30,
    priority: 'MEDIUM',
    completed: false,
    project: 'Personal'
  },
  {
    id: '4',
    title: 'Prepare tomorrow\'s schedule & review',
    startTime: '21:30',
    durationMinutes: 20,
    priority: 'LOW',
    completed: false,
    project: 'Personal'
  }
];

const DEFAULT_SETTINGS: UserSettings = {
  dayStartTime: '07:00',
  bedTime: '23:00',
  notificationsEnabled: true,
  defaultDuration: 45
};

// --- HELPER FUNCTIONS ---
function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(totalMinutes: number): string {
  const normalized = (totalMinutes + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatMinutesToHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// --- MAIN TEMPO APP COMPONENT ---
export default function TempoApp() {
  // --- STATE ---
  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem('tempo_tasks');
    return saved ? JSON.parse(saved) : INITIAL_TASKS;
  });

  const [settings, setSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('tempo_settings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  const [now, setNow] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<'dashboard' | 'timeline' | 'tasks' | 'stats' | 'settings'>('dashboard');
  
  // Modal states
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [showMorningBrief, setShowMorningBrief] = useState(false);
  const [showEveningWrap, setShowEveningWrap] = useState(false);
  const [showFixLog, setShowFixLog] = useState<string[] | null>(null);

  // Form State
  const [taskForm, setTaskForm] = useState<{
    title: string;
    startTime: string;
    durationMinutes: number;
    priority: Priority;
    project: string;
  }>({
    title: '',
    startTime: '10:00',
    durationMinutes: 45,
    priority: 'MEDIUM',
    project: 'University'
  });

  // Sync LocalStorage
  useEffect(() => {
    localStorage.setItem('tempo_tasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem('tempo_settings', JSON.stringify(settings));
  }, [settings]);

  // Live Timer Ticker
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  // Time metrics
  const currentMinutes = useMemo(() => now.getHours() * 60 + now.getMinutes(), [now]);
  const bedMinutes = useMemo(() => timeToMinutes(settings.bedTime), [settings.bedTime]);
  const dayStartMins = useMemo(() => timeToMinutes(settings.dayStartTime), [settings.dayStartTime]);

  // Remaining daylight/waking time
  const remainingAvailableMinutes = Math.max(0, bedMinutes - currentMinutes);
  
  // Day Elapsed Percent
  const dayElapsedPercent = useMemo(() => {
    const totalDayMins = bedMinutes - dayStartMins;
    if (totalDayMins <= 0) return 100;
    const elapsed = Math.max(0, currentMinutes - dayStartMins);
    return Math.min(100, Math.round((elapsed / totalDayMins) * 100));
  }, [currentMinutes, bedMinutes, dayStartMins]);

  // Task Calculations
  const remainingTasks = useMemo(() => tasks.filter(t => !t.completed), [tasks]);
  const completedTasks = useMemo(() => tasks.filter(t => t.completed), [tasks]);
  
  const totalPlannedMinutes = useMemo(() => tasks.reduce((acc, t) => acc + t.durationMinutes, 0), [tasks]);
  const completedMinutes = useMemo(() => completedTasks.reduce((acc, t) => acc + t.durationMinutes, 0), [completedTasks]);
  const remainingWorkMinutes = useMemo(() => remainingTasks.reduce((acc, t) => acc + t.durationMinutes, 0), [remainingTasks]);

  const completionPercentage = useMemo(() => {
    if (tasks.length === 0) return 100;
    return Math.round((completedTasks.length / tasks.length) * 100);
  }, [tasks, completedTasks]);

  // --- HEALTH STATUS CALCULATION ---
  const healthStatus = useMemo(() => {
    if (remainingTasks.length === 0) return { label: 'On track', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', state: 'GREEN' };
    const buffer = remainingAvailableMinutes - remainingWorkMinutes;
    if (buffer >= 30) return { label: 'On track', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', state: 'GREEN' };
    if (buffer >= 0) return { label: 'Needs attention', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', state: 'YELLOW' };
    return { label: 'Falling behind', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20', state: 'RED' };
  }, [remainingAvailableMinutes, remainingWorkMinutes, remainingTasks]);

  // --- CURRENT FOCUS / NEXT UP FOCUS ---
  const currentFocus = useMemo(() => {
    for (let task of remainingTasks) {
      const startMins = timeToMinutes(task.startTime);
      const endMins = startMins + task.durationMinutes;
      if (currentMinutes >= startMins && currentMinutes < endMins) {
        return { task, status: 'NOW', remaining: endMins - currentMinutes };
      }
    }
    // Find Next
    const upcoming = [...remainingTasks]
      .filter(t => timeToMinutes(t.startTime) > currentMinutes)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    if (upcoming.length > 0) {
      const nextTask = upcoming[0];
      const startMins = timeToMinutes(nextTask.startTime);
      return { task: nextTask, status: 'NEXT', startsIn: startMins - currentMinutes };
    }

    return null;
  }, [remainingTasks, currentMinutes]);

  // --- SMART WARNINGS ---
  const smartWarnings = useMemo(() => {
    const warnings: string[] = [];
    
    // Check overdue
    remainingTasks.forEach(t => {
      const startMins = timeToMinutes(t.startTime);
      if (currentMinutes > startMins + t.durationMinutes) {
        warnings.push(`Task overdue: "${t.title}" was scheduled for ${t.startTime}.`);
      }
    });

    // Check overload
    if (remainingWorkMinutes > remainingAvailableMinutes && remainingAvailableMinutes > 0) {
      const diff = remainingWorkMinutes - remainingAvailableMinutes;
      warnings.push(`Schedule Overload: You have ${formatMinutesToHours(remainingWorkMinutes)} of work remaining but only ${formatMinutesToHours(remainingAvailableMinutes)} available before bedtime. Over capacity by ${formatMinutesToHours(diff)}.`);
    }

    // Evening check
    if (currentMinutes >= 1200 && remainingTasks.filter(t => t.priority === 'HIGH').length > 0) {
      warnings.push(`Evening Alert: High priority tasks still remain with limited hours left tonight.`);
    }

    return warnings;
  }, [remainingTasks, currentMinutes, remainingWorkMinutes, remainingAvailableMinutes]);

  // --- SMART RESCHEDULER: FIX MY DAY ---
  const handleFixMyDay = () => {
    if (remainingTasks.length === 0) return;

    const log: string[] = [];
    let currentTimeCursor = Math.max(currentMinutes + 5, dayStartMins);

    // Sort uncompleted tasks by Priority (HIGH > MEDIUM > LOW) and original startTime
    const priorityWeight: Record<Priority, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    
    const uncompleted = [...remainingTasks].sort((a, b) => {
      const pDiff = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (pDiff !== 0) return pDiff;
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });

    const newTasks = tasks.map(t => {
      if (t.completed) return t; // Never move completed tasks

      const taskIndex = uncompleted.findIndex(u => u.id === t.id);
      if (taskIndex !== -1) {
        const newStartStr = minutesToTime(currentTimeCursor);
        if (newStartStr !== t.startTime) {
          log.push(`Shifted "${t.title}" from ${t.startTime} to ${newStartStr}`);
        }
        const updated = { ...t, startTime: newStartStr };
        // Add duration + 10 min buffer
        currentTimeCursor += t.durationMinutes + 10;
        return updated;
      }
      return t;
    });

    setTasks(newTasks);
    setShowFixLog(log.length > 0 ? log : ['Your schedule is already optimal!']);
  };

  // Toggle Completion
  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  // Create Task
  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.title.trim()) return;

    const newTask: Task = {
      id: Date.now().toString(),
      title: taskForm.title,
      startTime: taskForm.startTime,
      durationMinutes: Number(taskForm.durationMinutes),
      priority: taskForm.priority,
      completed: false,
      project: taskForm.project || 'General'
    };

    setTasks(prev => [...prev, newTask]);
    setTaskForm({ title: '', startTime: '12:00', durationMinutes: 45, priority: 'MEDIUM', project: 'University' });
    setShowNewTaskModal(false);
  };

  // Delete Task
  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  // Dynamic Greeting & Theme Mood
  const timeOfDayGreeting = useMemo(() => {
    const hr = now.getHours();
    if (hr < 12) return { text: 'Good morning', mood: 'from-amber-500/10 via-slate-900 to-slate-950' };
    if (hr < 17) return { text: 'Good afternoon', mood: 'from-sky-500/10 via-slate-900 to-slate-950' };
    if (hr < 21) return { text: 'Good evening', mood: 'from-indigo-500/10 via-slate-900 to-slate-950' };
    return { text: 'Good night', mood: 'from-purple-950/20 via-slate-900 to-slate-950' };
  }, [now]);

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white bg-gradient-to-b ${timeOfDayGreeting.mood} transition-colors duration-1000`}>
      
      {/* HEADER / NAVIGATION */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-slate-950/70 border-b border-slate-800/60 px-4 lg:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/25">
              T
            </div>
            <span className="text-xl font-bold tracking-tight text-white">tempo<span className="text-indigo-400">.</span></span>
          </div>

          {/* Status Badge */}
          <div className={`hidden sm:flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium border ${healthStatus.bg} ${healthStatus.color}`}>
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 fill-current`}></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
            </span>
            <span>{healthStatus.label}</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <button 
            onClick={handleFixMyDay}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-semibold text-xs sm:text-sm shadow-md shadow-orange-500/20 active:scale-95 transition-all"
          >
            <Sparkles className="h-4 w-4" />
            <span>Fix My Day</span>
          </button>

          <button 
            onClick={() => setShowMorningBrief(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs sm:text-sm font-medium transition-colors hidden md:block"
          >
            Morning Brief
          </button>

          <button 
            onClick={() => setShowEveningWrap(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs sm:text-sm font-medium transition-colors hidden md:block"
          >
            Evening Wrap
          </button>

          <button 
            onClick={() => setShowNewTaskModal(true)}
            className="p-1.5 sm:px-3 sm:py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs sm:text-sm flex items-center space-x-1 shadow-lg shadow-indigo-600/30 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Task</span>
          </button>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: HERO, FOCUS, TASKS (8 COLS) */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* HERO BANNER */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900/90 via-slate-900/40 to-slate-950 border border-slate-800/80 p-6 sm:p-8 backdrop-blur-xl">
            <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-10">
              <div>
                <span className="text-xs uppercase tracking-widest text-indigo-400 font-semibold">
                  {now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </span>
                <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mt-1">
                  {timeOfDayGreeting.text}.
                </h1>
                <p className="text-slate-400 text-sm mt-1">
                  Your day, under control.
                </p>
              </div>

              {/* Day Circular / Numerical Metric Visualizer */}
              <div className="flex items-center space-x-4 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 w-full sm:w-auto justify-around">
                <div className="text-center">
                  <div className="text-xs text-slate-400">Day Elapsed</div>
                  <div className="text-lg font-bold text-white">{dayElapsedPercent}%</div>
                </div>
                <div className="h-8 w-px bg-slate-800" />
                <div className="text-center">
                  <div className="text-xs text-slate-400">Work Done</div>
                  <div className="text-lg font-bold text-indigo-400">{completionPercentage}%</div>
                </div>
                <div className="h-8 w-px bg-slate-800" />
                <div className="text-center">
                  <div className="text-xs text-slate-400">Time Left</div>
                  <div className="text-lg font-bold text-emerald-400">{formatMinutesToHours(remainingAvailableMinutes)}</div>
                </div>
              </div>
            </div>

            {/* Smart Warnings Display */}
            {smartWarnings.length > 0 && (
              <div className="mt-6 space-y-2">
                {smartWarnings.map((warning, idx) => (
                  <div key={idx} className="flex items-center space-x-2 text-xs sm:text-sm bg-rose-500/10 border border-rose-500/20 text-rose-300 p-3 rounded-lg">
                    <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CURRENT FOCUS / NEXT TASK BANNER */}
          {currentFocus ? (
            <div className="rounded-xl bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-500/30 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase ${currentFocus.status === 'NOW' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300'}`}>
                    {currentFocus.status === 'NOW' ? 'CURRENT FOCUS' : 'NEXT UP'}
                  </span>
                  <span className="text-xs text-slate-400">{currentFocus.task.project}</span>
                </div>
                <h3 className="text-lg font-bold text-white">{currentFocus.task.title}</h3>
                <div className="text-xs text-slate-400 flex items-center space-x-3">
                  <span>Scheduled: {currentFocus.task.startTime} ({currentFocus.task.durationMinutes} min)</span>
                  {currentFocus.status === 'NOW' && (
                    <span className="text-indigo-400 font-semibold">• {currentFocus.remaining}m remaining</span>
                  )}
                  {currentFocus.status === 'NEXT' && (
                    <span className="text-emerald-400 font-semibold">• Starts in {currentFocus.startsIn}m</span>
                  )}
                </div>
              </div>

              <button 
                onClick={() => toggleTask(currentFocus.task.id)}
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm flex items-center justify-center space-x-2 shrink-0 transition-all shadow-md shadow-indigo-600/20"
              >
                <Check className="h-4 w-4" />
                <span>Mark Complete</span>
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-900/50 border border-slate-800/60 p-5 text-center text-slate-400 text-sm">
              ✨ No task active right now. Enjoy your breather or add a new task!
            </div>
          )}

          {/* TASK LIST CONTROL & CONTAINER */}
          <div className="bg-slate-900/40 rounded-2xl border border-slate-800/80 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white flex items-center space-x-2">
                <span>Today's Schedule</span>
                <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{tasks.length}</span>
              </h2>

              {/* Navigation Tabs */}
              <div className="flex bg-slate-950 p-1 rounded-lg 
