function readPackage(pkg) {
  if (pkg.dependencies && pkg.dependencies['es5-ext']) {
    pkg.dependencies['es5-ext'] = '0.10.53';
  }
  if (pkg.devDependencies && pkg.devDependencies['es5-ext']) {
    pkg.devDependencies['es5-ext'] = '0.10.53';
  }
  if (pkg.dependencies && pkg.dependencies['form-data']) {
    const v = pkg.dependencies['form-data'];
    if (v.startsWith('2.') || v === '^2' || v.includes('2.3')) {
      pkg.dependencies['form-data'] = '^4.0.0';
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };

