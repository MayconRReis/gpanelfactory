// MOCK
export const getFarolPriorities = async () => {
  return [
    { opNumber: '40231', priority: 'Crítica' },
    { opNumber: '40232', priority: 'Alta' },
    { opNumber: '40233', priority: 'Normal' },
  ];
};

export const getStoqueMaisAvailability = async (opNumber: string) => {
  // MOCK: Simulates checking inventory
  const mockData: Record<string, number> = {
    '40231': 5000,
    '40232': 1000,
    '40233': 0,
  };
  return mockData[opNumber] || 10000;
};
