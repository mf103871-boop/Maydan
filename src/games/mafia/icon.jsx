import React, { useId } from 'react';
// Original council lantern, rather than another game's characters or insignia.
export function MafiaIcon() {
  const uid = useId().replace(/:/g, '');
  return <svg viewBox="0 0 180 180" fill="none" aria-hidden="true"><defs><linearGradient id={`${uid}-night`} x2="1" y2="1"><stop stopColor="#275B6E"/><stop offset="1" stopColor="#322947"/></linearGradient><linearGradient id={`${uid}-gold`} x2="0" y2="1"><stop stopColor="#F9D38A"/><stop offset="1" stopColor="#B87542"/></linearGradient></defs><ellipse cx="90" cy="155" rx="59" ry="12" fill="#30243C" opacity=".18"/><path d="M33 79Q90 16 147 79V136Q90 163 33 136Z" fill={`url(#${uid}-night)`} stroke="#754F73" strokeWidth="5"/><path d="M90 31V46M76 46Q90 31 104 46L114 58H66Z" fill={`url(#${uid}-gold)`} stroke="#A87549" strokeWidth="3"/><path d="M69 58H111L105 120H75Z" fill="#EBC785" stroke="#A87549" strokeWidth="4"/><path d="M89 64V114M74 84H108" stroke="#BA854F" strokeWidth="4"/><path d="M81 105Q70 84 91 71Q87 86 100 88Q109 102 94 110Z" fill="#FFF2BD"/><path d="M72 121H108L117 133H63Z" fill={`url(#${uid}-gold)`}/><path d="M43 99Q54 90 66 99Q54 111 43 99ZM114 99Q126 90 138 99Q126 111 114 99Z" fill="#7DD1CE"/><circle cx="133" cy="40" r="9" fill="#EAC88B"/><path d="M137 31A9 9 0 0 0 139 47A9 9 0 0 1 137 31Z" fill="#FEF5DA"/><path d="M40 49V59M35 54H45M129 63V71M125 67H133" stroke="#D7AC71" strokeWidth="3" strokeLinecap="round"/></svg>;
}
const signs = {
  citizen: <><path d="M15 38V25L32 12L49 25V38M23 46V31H41V46"/><path d="M13 48H51"/></>,
  investigator: <><circle cx="28" cy="26" r="13"/><path d="M38 36L51 49M23 27L27 31L34 22"/></>,
  doctor: <><path d="M23 12H41V24H53V41H41V53H23V41H11V24H23Z"/></>,
  guard: <><path d="M32 9L50 16V32Q50 45 32 55Q14 45 14 32V16Z"/><path d="M23 31L29 38L42 24"/></>,
  observer: <><path d="M7 32Q32 4 57 32Q32 60 7 32Z"/><circle cx="32" cy="32" r="9"/></>,
  reporter: <><rect x="14" y="10" width="36" height="45" rx="4"/><path d="M22 20H42M22 28H42M22 36H34M22 44H42"/></>,
  herald: <><path d="M10 26H23L49 14V48L23 37H10ZM22 37L26 51H17L14 37M54 24V37"/></>,
  analyst: <><circle cx="20" cy="22" r="9"/><circle cx="44" cy="42" r="9"/><path d="M29 22H44V33M35 42H20V31"/></>,
  mafia: <><path d="M9 22Q32 36 55 22L51 40Q32 57 13 40Z"/><path d="M17 32L25 36M39 36L47 32"/></>,
  masker: <><path d="M11 17Q28 24 42 13V36Q28 57 13 38ZM42 25L53 27V43Q43 54 31 47"/><path d="M19 29L25 31M33 29L37 26"/></>,
  blocker: <><path d="M20 29V17Q20 7 32 7Q44 7 44 17V29"/><rect x="14" y="28" width="36" height="27" rx="6"/><path d="M32 37V46"/></>,
  leader: <><path d="M43 10A22 22 0 1 0 54 42A24 24 0 0 1 43 10Z"/><path d="M47 13V23M42 18H52"/></>,
};
export function MafiaRoleArt({ roleId }) { return <svg className="mafia-role-art" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{signs[roleId] || signs.citizen}</svg>; }
