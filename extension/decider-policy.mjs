export const T_LOW=0.000522539983057867;
export const T_HIGH=0.9998533564805935;
export function meaningBand(p){
 if(!Number.isFinite(p)||p<0||p>1)throw Error('invalid-meaning-score');
 return p>=T_HIGH?'warn':p<T_LOW?'low':'unsure';
}
