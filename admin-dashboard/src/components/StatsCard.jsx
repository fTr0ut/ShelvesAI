import { useNavigate } from 'react-router-dom';

export default function StatsCard({ title, value, subtitle, color = 'blue', to }) {
  const navigate = useNavigate();
  const colors = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
    indigo: 'bg-indigo-500',
  };

  const clickable = !!to;

  return (
    <div
      className={`bg-white overflow-hidden shadow rounded-lg ${clickable ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''}`}
      onClick={clickable ? () => navigate(to) : undefined}
    >
      <div className="p-5">
        <div className="flex items-center">
          <div className={`flex-shrink-0 rounded-md p-3 ${colors[color]}`}>
            <div className="h-6 w-6 text-white" />
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
              <dd className="flex items-baseline">
                <div className="text-2xl font-semibold text-gray-900">{value}</div>
                {subtitle && (
                  <span className="ml-2 text-sm text-gray-500">{subtitle}</span>
                )}
              </dd>
            </dl>
          </div>
          {clickable && (
            <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
