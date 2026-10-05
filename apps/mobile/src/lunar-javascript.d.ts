declare module 'lunar-javascript' {
  interface LunarDate {
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getYearInGanZhi(): string;
    getYearShengXiao(): string;
    getJieQi(): string;
    getFestivals(): string[];
  }
  export const Solar: { fromYmd(year: number, month: number, day: number): { getLunar(): LunarDate; getFestivals(): string[] } };
}
