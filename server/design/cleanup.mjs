// Studio content belongs to the app, rather than to the editor's social account.
// Preserve immutable designs/shared images while severing account attribution.
export function designDeleteStatements(env,userId) {
  const statement=(sql,...args)=>env.DB.prepare(sql).bind(...args);
  return [
    statement('DELETE FROM design_previews WHERE user_id=?',userId),
    statement('UPDATE design_draft SET updated_by=NULL WHERE updated_by=?',userId),
    statement('UPDATE design_publication SET updated_by=NULL WHERE updated_by=?',userId),
    statement("UPDATE design_versions SET created_by='deleted-account' WHERE created_by=?",userId),
    statement("UPDATE design_assets SET created_by='deleted-account' WHERE created_by=?",userId),
    statement("UPDATE design_actions SET actor_id='deleted-account' WHERE actor_id=?",userId),
  ];
}
