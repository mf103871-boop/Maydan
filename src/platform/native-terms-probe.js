// Opted-in simulator automation operates the same unchecked consent form a
// person sees. It never writes acceptance storage or fabricates a server record.
export function startSimulatorTermsProbe(host = globalThis.window) {
  const token=host?.__maydanSimulatorLaunchToken;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token||'')
    || typeof host?.webkit?.messageHandlers?.maydan?.postMessage!=='function'
    || host.__maydanSimulatorTermsStarted===token) return undefined;
  host.__maydanSimulatorTermsStarted=token;
  let timer, stopped=false;
  const deadline=Date.now()+20000;
  const stop=()=>{stopped=true;host.clearTimeout(timer);};
  const visible=node=>node && !node.closest('[hidden],[inert]') && node.getBoundingClientRect().width>0 && node.getBoundingClientRect().height>0;
  const step=()=>{
    if(stopped || host.__maydanSimulatorLaunchToken!==token || Date.now()>=deadline) {stop();return;}
    if(host.document.visibilityState==='visible') {
      const form=host.document.querySelector('[data-design-screen="legal.consent"] form');
      const checkbox=form?.querySelector('input[type="checkbox"]');
      const submit=form?.querySelector('button[type="submit"]');
      if(visible(checkbox)&&!checkbox.disabled&&!checkbox.checked) checkbox.click();
      else if(visible(submit)&&!submit.disabled) submit.click();
      else if(visible(host.document.querySelector('[data-design-screen="home"]'))) {stop();return;}
    }
    timer=host.setTimeout(step,100);
  };
  step();return stop;
}
