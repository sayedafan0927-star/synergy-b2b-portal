import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    errorId: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    const errorId = `ERR-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    return { hasError: true, error, errorId };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary caught error]', {
      errorId: this.state.errorId,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  private toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6 font-sans">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-6 sm:p-8 text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-rose-100 shadow-sm">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <h1 className="text-xl font-bold text-slate-900 mb-2">
              Произошла ошибка в работе портала
            </h1>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              Компонент интерфейса столкнулся с непредвиденным исключением. Ваши данные сохранены в безопасности.
            </p>

            {this.state.errorId && (
              <div className="bg-slate-100 rounded-lg px-3 py-1.5 text-xs text-slate-600 font-mono inline-block mb-6">
                Идентификатор ошибки: <span className="font-bold text-slate-800">{this.state.errorId}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
              <button
                onClick={this.handleReload}
                className="flex items-center justify-center gap-2 bg-brand-700 hover:bg-brand-800 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-sm active:scale-95"
              >
                <RefreshCw className="w-4 h-4" />
                Перезагрузить
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95"
              >
                <Home className="w-4 h-4" />
                На главную
              </button>
            </div>

            {this.state.error && (
              <div className="text-left mt-6 pt-4 border-t border-slate-100">
                <button
                  onClick={this.toggleDetails}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 font-medium transition-colors"
                >
                  {this.state.showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {this.state.showDetails ? 'Скрыть технические детали' : 'Технические детали ошибки'}
                </button>

                {this.state.showDetails && (
                  <div className="mt-3 p-3 bg-slate-900 rounded-lg text-slate-300 font-mono text-[11px] overflow-x-auto max-h-48 whitespace-pre-wrap">
                    <p className="text-rose-400 font-bold mb-1">{this.state.error.toString()}</p>
                    {this.state.errorInfo?.componentStack}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
