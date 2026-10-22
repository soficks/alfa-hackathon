import { useState } from 'react';
import { APP_STATES } from '../engine/stateMachine';

export default function Calculator({ profile, setAppState }) {
  const [amount, setAmount] = useState(2000000);
  const [term, setTerm] = useState(24);

  const handleSubmit = () => {
    // Запускаем флоу конвейера на фронте
    setAppState(APP_STATES.ENRICHMENT);
  };

  return (
    <div className="flex gap-8">
      {/* Левая часть - Ползунки */}
      <div className="flex-1 bg-white p-8 rounded-[24px] shadow-sm border">
        <div className="mb-8">
          <label className="block text-sm text-gray-500 mb-4 font-bold">Сумма финансирования</label>
          <div className="text-3xl font-bold mb-4">{amount.toLocaleString('ru-RU')} ₽</div>
          <input 
            type="range" min="500000" max="10000000" step="100000" 
            value={amount} 
            onChange={(e) => setAmount(Number(e.target.value))} 
            className="w-full accent-[#ef3124]" 
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm text-gray-500 mb-4 font-bold">Срок кредитования</label>
          <div className="text-3xl font-bold mb-4">{term} месяца</div>
          <input 
            type="range" min="6" max="60" step="1" 
            value={term} 
            onChange={(e) => setTerm(Number(e.target.value))} 
            className="w-full accent-[#ef3124]" 
          />
        </div>
      </div>

      {/* Правая часть - Чек */}
      <div className="w-80 bg-red-50 p-6 rounded-[24px] flex flex-col justify-between border border-red-100">
        <div>
          <h3 className="font-bold mb-6 text-lg">Предварительный расчёт</h3>
          <div className="space-y-4 text-sm">
            <div className="flex justify-between border-b border-red-200 pb-2">
              <span className="text-gray-500">Сумма</span>
              <span className="font-bold">{amount.toLocaleString('ru-RU')} ₽</span>
            </div>
            <div className="flex justify-between border-b border-red-200 pb-2">
              <span className="text-gray-500">Срок</span>
              <span className="font-bold">{term} мес.</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Ставка</span>
              <span className="font-bold text-right text-xs">Условия уточним<br/>после проверки</span>
            </div>
          </div>
        </div>
        <button 
          onClick={handleSubmit}
          className="w-full bg-[#ef3124] text-white py-4 rounded-xl font-bold mt-8 hover:bg-red-700 transition-colors"
        >
          Продолжить ➔
        </button>
      </div>
    </div>
  );
}