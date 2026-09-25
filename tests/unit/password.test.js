import { hashPassword, comparePassword } from '../../src/utils/password.js';

describe('Password Utils', () => {
    test('genera un hash diferente al password original', async () => {
        const password = '123456';
        const hash = await hashPassword(password);

        expect(hash).toBeDefined();
        expect(hash).not.toBe(password);
    });

    test('valida un password correcto', async () => {
        const password = '123456';
        const hash = await hashPassword(password);

        expect(await comparePassword(password, hash)).toBe(true);
    });

    test('rechaza un password incorrecto', async () => {
        const hash = await hashPassword('123456');

        expect(await comparePassword('incorrecto', hash)).toBe(false);
    });
});
