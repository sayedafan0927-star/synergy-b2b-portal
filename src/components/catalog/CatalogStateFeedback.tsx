import { X } from 'lucide-react';

export function CatalogLoadingSkeleton() {
  return (
    <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8">
      <div className="container-w">
        <div className="mb-8">
          <div className="skeleton h-8 w-64 mb-3" />
          <div className="skeleton h-4 w-96 max-w-full" />
        </div>
        <div className="mb-6 flex gap-3">
          <div className="skeleton h-11 w-28" />
          <div className="skeleton h-11 w-40" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card overflow-hidden">
              <div className="skeleton aspect-[4/3] rounded-none" />
              <div className="p-3 sm:p-4 space-y-2">
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-2/3" />
                <div className="skeleton h-4 w-20 mt-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CatalogLoadError() {
  return (
    <section className="min-h-screen bg-slate-50 pt-20 pb-24 lg:pb-8 flex items-center justify-center">
      <div className="text-center max-w-md px-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 mb-5 mx-auto">
          <X className="h-7 w-7 text-red-500" />
        </div>
        <h3 className="text-lg font-semibold text-slate-800 mb-2">Не удалось загрузить каталог</h3>
        <p className="text-sm text-slate-500 mb-5">Проверьте подключение к интернету и попробуйте снова</p>
        <button type="button" onClick={() => window.location.reload()} className="btn-primary cursor-pointer">
          Повторить
        </button>
      </div>
    </section>
  );
}
