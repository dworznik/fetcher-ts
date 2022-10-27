import fetch, { Response } from 'cross-fetch';
import * as E from 'fp-ts/lib/Either';
import { flow, pipe } from 'fp-ts/lib/function';
import * as TE from 'fp-ts/lib/TaskEither';
import * as io from 'io-ts';
import { failure } from 'io-ts/lib/PathReporter';
import _fetch from './mocks/fetch';

import * as F from './fetcher';

const unexpectedError = () => TE.left(new Error('unexpected error'));
const decodeError = (errors: io.Errors): Error => new Error(failure(errors).join('\n'));
const process200 = <T>() => flow(
  E.bimap(decodeError, (payload: T) => ({ code: 200 as const, payload })),
  TE.fromEither,
);
const process400 = <T>() => flow(
  E.bimap(decodeError, (payload: T) => ({ code: 400 as const, payload })),
  TE.fromEither,
);

describe('Fetcher suite', () => {
  it('should handle simple 200 response with text data', async () => {
    _fetch.reset();
    _fetch.mock('http://host.tld', { status: 200, body: 'foo' });
    const fetcher = F.make(
      'http://host.tld',
      {
        200: flow(F.stringDecoder, TE.chain(flow(io.string.decode, process200()))),
      },
      unexpectedError,
    );

    pipe(
      await F.toTaskEither(fetch)(fetcher)(),
      E.fold(
        fail,
        ({ code, payload }) => {
          expect(code).toEqual(200);
          expect(payload).toEqual('foo');
        },
      ),
    );
  });

  it('should handle simple 200 response with JSON data', async () => {
    const TTestData = io.type({ foo: io.string, baz: io.number });
    const TEST_DATA = { foo: 'bar', baz: 42 };
    _fetch.reset();
    _fetch.mock('http://host.tld', { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(TEST_DATA) });

    const fetcher = F.make(
      'http://host.tld',
      {
        200: flow(F.jsonDecoder, TE.chain(flow(TTestData.decode, process200()))),
      },
      unexpectedError,
    );

    pipe(
      await F.toTaskEither(fetch)(fetcher)(),
      E.fold(
        fail,
        ({ code, payload }) => {
          expect(code).toEqual(200);
          expect(payload).toStrictEqual(TEST_DATA);
        },
      ),
    );
  });

  it('should handle simple 400 response', async () => {
    type TestMethod =
      | { code: 200, payload: number; }
      | { code: 400, payload: string; };

    _fetch.reset();
    _fetch.mock('http://host.tld', { status: 400, body: 'fooo' });

    const fetcher = F.make<TestMethod['code'], Error, TestMethod>(
      'http://host.tld',
      {
        200: () => fail('should not be 200'),
        400: flow(F.stringDecoder, TE.chain(flow(io.string.decode, process400()))),
      },
      unexpectedError,
    );

    pipe(
      await F.toTaskEither(fetch)(fetcher)(),
      E.fold(
        fail,
        ({ code, payload }) => {
          expect(code).toEqual(400);
          expect(payload).toStrictEqual('fooo');
        },
      ),
    );
  });

  it('should validate incorrectly shaped responses', async () => {
    const TTestData = io.type({ foo: io.string, baz: io.number });

    _fetch.reset();
    _fetch.mock('http://host.tld', { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ foo: 'bar', baz: '42' }) });

    const fetcher = F.make(
      'http://host.tld',
      {
        200: flow(F.jsonDecoder, TE.chain(flow(TTestData.decode, process200()))),
      },
      unexpectedError,
    );

    pipe(
      await F.toTaskEither(fetch)(fetcher)(),
      E.fold(
        (e) => {
          expect(e.message).toContain('Invalid value "42" supplied to : { foo: string, baz: number }/baz: number');
        },
        fail,
      ),
    );
  });

  it('should get data from headers using custom decoder', async () => {
    type TestMethod =
      | { code: 200, payload: number; }
      | { code: 400, payload: string; };

    _fetch.reset();
    _fetch.mock('http://host.tld', { status: 400, headers: { 'x-payload': 'fooo' } });

    const process400Headers = (res: Response) =>
      async () => E.fromNullable(new Error('Header "x-payload" not found'))(res.headers.get('x-payload'));
    const fetcher = F.make<TestMethod['code'], Error, TestMethod>(
      'http://host.tld',
      {
        200: () => fail('should not be 200'),
        400: flow(process400Headers, TE.chain(flow(io.string.decode, process400()))),
      },
      unexpectedError,
    );

    pipe(
      await F.toTaskEither(fetch)(fetcher)(),
      E.fold(
        fail,
        ({ code, payload }) => {
          expect(code).toEqual(400);
          expect(payload).toStrictEqual('fooo');
        },
      ),
    );
  });
});
