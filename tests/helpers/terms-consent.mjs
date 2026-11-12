import assert from 'node:assert/strict';

// Test automation only: operate the same unchecked form as a person. This
// helper does not seed acceptance, forge a receipt or bypass any server guard.
// Call after the startup screen settles. `required:false` also supports reloads
// and management routes which correctly have no first-use boundary.
export async function acceptTermsIfShown(page,{required=true,locale}={}) {
  const form=page.locator('[data-design-screen="legal.consent"]');
  if(!required) {
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForFunction(()=>{
      const visible=node=>node&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0&&!node.closest('[hidden],[inert]');
      return visible(document.querySelector('[data-design-screen="legal.consent"]'))||[...document.querySelectorAll('[data-design-screen]')].some(node=>! /^(?:shell|system)\./.test(node.dataset.designScreen)&&visible(node));
    });
    if(!await form.isVisible())return false;
  }
  await form.waitFor({state:'visible'});
  if(locale)assert.equal(await form.getAttribute('lang'),locale);
  const checkbox=form.getByRole('checkbox'),submit=form.locator('button[type="submit"]');
  await page.waitForFunction(()=>{const input=document.querySelector('[data-design-screen="legal.consent"] input[type="checkbox"]');return input&&!input.disabled;});
  assert.equal(await checkbox.isChecked(),false,'first-use choice is never preselected');
  assert.equal(await submit.isDisabled(),true,'agreement stays blocked until the explicit checkbox choice');
  await checkbox.check();await submit.click();await form.waitFor({state:'detached'});
  return true;
}
