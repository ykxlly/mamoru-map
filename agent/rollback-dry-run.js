const id = process.argv[2];
if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('valid rollback deployment id required');
console.log(`ROLLBACK_DRY_RUN_OK deployment=${id}`);
