import { Circle } from 'lucide-react';

const StatusDot = ({ status }) => {
  if (status === 'done') {
    return <Circle className="h-3.5 w-3.5 fill-emerald-400 text-emerald-400" />;
  }

  if (status === 'active') {
    return <Circle className="h-3.5 w-3.5 fill-cyan-400 text-cyan-400 animate-pulse" />;
  }

  return <Circle className="h-3.5 w-3.5 fill-slate-500 text-slate-500" />;
};

export default StatusDot;
