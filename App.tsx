import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Plus, Trash2, Calendar, CheckSquare, Clock, BarChart2, ShieldAlert } from 'lucide-react';

interface Task {
  id: string;
  title: string;
  duration: number; // in minutes
  completed: boolean;
  type: 'deep' | 'light' | 'routine';
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem('tempo_tasks');
    return saved ? JSON.parse(saved) : [
      { id: '1', title: 'مراجعة المحاضرات', duration: 45, completed: false, type: 'deep' },
      { id: '2', title: 'ترتيب المكتب', duration: 15, completed: false, type: 'light' }
    ];
  });

  const [activeTab, setActiveTab] = useState<'timer' | 'tasks' | 'stats'>('timer');
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(25 * 60);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDuration, setNewTaskDuration] = useState('25');
  const [newTaskType, setNewTaskType] = useState<'deep' | 'light' | 'routine'>('deep');

  useEffect(() => {
    localStorage.setItem('tempo_tasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    let timer: any = null;
    if (isRunning && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isRunning) {
      setIsRunning(false);
      if (activeTask) {
        toggleTask(activeTask.id);
      }
    }
    return () => clearInterval(timer);
  }, [isRunning, timeLeft, activeTask]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startTaskTimer = (task: Task) => {
    setActiveTask(task);
    setTimeLeft(task.duration * 60);
    setIsRunning(true);
    setActiveTab('timer');
  };

  const toggleTask = (id: string) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const deleteTask = (id: string) => {
    setTasks(tasks.filter(t => t.id !== id));
    if (activeTask?.id === id) {
      setActiveTask(null);
      setIsRunning(false);
    }
  };

  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const task: Task = {
      id: Date.now().toString(),
      title: newTaskTitle,
      duration: parseInt(newTaskDuration) || 25,
      completed: false,
      type: newTaskType
    };
    setTasks([...tasks, task]);
    setNewTaskTitle('');
  };

  const completedCount = tasks.filter(t => t.completed).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans dir-rtl" dir="rtl">
      {/* Header */}
      <header className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 backdrop-blur">
        <div className="flex items-center gap-2">
          <Clock className="w-6 h-6 text-indigo-500" />
          <h1 className="text-xl font-bold tracking-wider text-white">TEMPO</h1>
        </div>
        <div className="text-xs text-slate-400 border border-slate-800 rounded-full px-3 py-1 bg-slate-900">
          إدارة الوقت الذكية
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 max-w-md mx-auto w-full flex flex-col justify-center">
        {activeTab === 'timer' && (
          <div className="flex flex-col items-center justify-center space-y-8 py-8">
            {activeTask && (
              <div className="bg-indigo-950/40 border border-indigo-800/50 rounded-lg px-4 py-2 text-indigo-300 text-sm font-medium">
                جاري العمل على: {activeTask.title}
              </div>
            )}

            {/* Circle Timer Display */}
            <div className="relative w-64 h-64 rounded-full border-4 border-slate-800 flex items-center justify-center bg-slate-900/40 shadow-2xl shadow-indigo-950/20">
              <div className="text-center">
                <span className="text-5xl font-mono font-bold tracking-tighter text-white">
                  {formatTime(timeLeft)}
                </span>
                <p className="text-xs text-slate-400 mt-2">
                  {isRunning ? 'الوقت يمشي...' : 'المؤقت متوقف'}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsRunning(!isRunning)}
                className="p-4 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-transform active:scale-95"
              >
                {isRunning ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 mr-0.5" />}
              </button>

              <button
                onClick={() => {
                  setIsRunning(false);
                  setTimeLeft((activeTask ? activeTask.duration : 25) * 60);
                }}
                className="p-4 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-transform active:scale-95"
              >
                <RotateCcw className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="space-y-6">
            {/* Add Task Form */}
            <form onSubmit={addTask} className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3">
              <h3 className="text-sm font-semibold text-slate-300">إضافة مهمة جديدة</h3>
              <input
                type="text"
                placeholder="عنوان المهمة..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="المدة (دقائق)"
                  value={newTaskDuration}
                  onChange={(e) => setNewTaskDuration(e.target.value)}
                  className="w-1/2 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
                <select
                  value={newTaskType}
                  onChange={(e: any) => setNewTaskType(e.target.value)}
                  className="w-1/2 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="deep">تركيز عميق</option>
                  <option value="light">خفيف</option>
                  <option value="routine">روتين</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 rounded-lg flex items-center justify-center gap-2 text-sm"
              >
                <Plus className="w-4 h-4" /> إضافة للمهمات
              </button>
            </form>

            {/* Task List */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-400">قائمة اليوم</h3>
              {tasks.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">لا يوجد مهمات حالياً</p>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                      task.completed
                        ? 'bg-slate-900/30 border-slate-900 opacity-60'
                        : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => toggleTask(task.id)}
                        className="w-4 h-4 accent-indigo-600 rounded"
                      />
                      <div>
                        <p className={`text-sm font-medium ${task.completed ? 'line-through text-slate-500' : 'text-white'}`}>
                          {task.title}
                        </p>
                        <span className="text-xs text-slate-400">{task.duration} دقيقة</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {!task.completed && (
                        <button
                          onClick={() => startTaskTimer(task)}
                          className="p-2 text-indigo-400 hover:bg-indigo-950/50 rounded-lg text-xs flex items-center gap-1"
                        >
                          <Play className="w-3.5 h-3.5" /> ابدأ
                        </button>
                      )}
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="p-2 text-rose-500 hover:bg-rose-950/30 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3">
              <h3 className="text-sm font-semibold text-slate-300">إحصائيات الإنجاز</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/50">
                  <p className="text-xs text-slate-400">المهمات المكتملة</p>
                  <p className="text-2xl font-bold text-indigo-400 mt-1">{completedCount}</p>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/50">
                  <p className="text-xs text-slate-400">إجمالي المهمات</p>
                  <p className="text-2xl font-bold text-white mt-1">{tasks.length}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Navigation Tabs */}
      <nav className="border-t border-slate-800 bg-slate-900/80 backdrop-blur p-2">
        <div className="flex bg-slate-950 p-1 rounded-lg max-w-md mx-auto">
          <button
            onClick={() => setActiveTab('timer')}
            className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'timer' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock className="w-4 h-4" /> المؤقت
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'tasks' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <CheckSquare className="w-4 h-4" /> المهام
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`flex-1 py-2 flex items-center justify-center gap-2 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'stats' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <BarChart2 className="w-4 h-4" /> الإحصائيات
          </button>
        </div>
      </nav>
    </div>
  );
              }
