"""Local tests with fake AI responses: no real API key needed."""
import os
import unittest
from unittest.mock import patch, MagicMock

os.environ['PONTE_VOZ_TESTING'] = '1'
os.environ['APP_ACCESS_CODE'] = 'codigo-testes-123456'

from fastapi.testclient import TestClient
from app import app, translate_text, transcribe_audio, validate_translation


class PonteVozTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()

    def sign_in(self):
        return self.client.post('/login', data={'access_code': 'codigo-testes-123456'}, follow_redirects=False)

    def test_health_works_without_login(self):
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ok')

    def test_login_required_for_site_and_api(self):
        response = self.client.get('/', follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers['location'], '/login')
        self.assertEqual(self.client.post('/api/translate', json={'text': 'Ola'}).status_code, 401)
        self.assertEqual(self.client.post('/api/voice', data={}).status_code, 401)

    def test_wrong_code_fails(self):
        response = self.client.post('/login', data={'access_code': 'errado'})
        self.assertEqual(response.status_code, 401)
        self.assertIn('incorreto', response.text)
        self.assertEqual(self.client.get('/', follow_redirects=False).status_code, 303)

    def test_login_then_home_and_security_headers(self):
        self.assertEqual(self.sign_in().status_code, 303)
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('Ponte Voz', response.text)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
        self.assertNotIn('codigo-testes-123456', response.headers.get('set-cookie', ''))

    def test_remembered_session_has_thirty_day_deadline(self):
        import time
        from itsdangerous import TimestampSigner
        import base64, json
        from app import session_secret
        response = self.client.post('/login', data={'access_code': 'codigo-testes-123456', 'remember': 'yes'})
        cookie = self.client.cookies.get('ponte_voz_sessao')
        session = json.loads(base64.b64decode(TimestampSigner(session_secret).unsign(cookie)))
        self.assertAlmostEqual(session['expires_at'] - time.time(), 30 * 86400, delta=5)
        self.assertIn('Max-Age=2592000', response.history[0].headers['set-cookie'])

    def test_short_session_and_expiry(self):
        import time
        from itsdangerous import TimestampSigner
        import base64, json
        from app import session_secret
        self.sign_in()
        session = json.loads(base64.b64decode(TimestampSigner(session_secret).unsign(self.client.cookies.get('ponte_voz_sessao'))))
        self.assertAlmostEqual(session['expires_at'] - time.time(), 8 * 3600, delta=5)
        with patch('app.time.time', return_value=time.time() + 9 * 3600):
            self.assertEqual(self.client.get('/', follow_redirects=False).status_code, 303)

    def test_translate_success_mock(self):
        self.sign_in()
        sample = {'detected_language': 'pt', 'target_language': 'uk', 'translation': 'Dobryi den'}
        with patch('app.translate_text', return_value=sample) as translate_mock:
            response = self.client.post('/api/translate', json={'text': 'Bom dia'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['translation'], 'Dobryi den')
        translate_mock.assert_called_once_with('Bom dia')

    def test_translate_validation(self):
        self.sign_in()
        self.assertEqual(self.client.post('/api/translate', json={'text': ' '}).status_code, 400)
        self.assertEqual(self.client.post('/api/translate', json={'text': 'A'*3001}).status_code, 400)
        self.assertEqual(self.client.post('/api/translate', content='ola').status_code, 400)
        self.assertEqual(self.client.post('/api/translate', json={'text': 12}).status_code, 400)

    def test_voice_success_mock(self):
        self.sign_in()
        with patch('app.transcribe_audio', return_value='Pryvit') as transcribe_mock, patch('app.translate_text', return_value={'detected_language': 'uk', 'target_language': 'pt', 'translation': 'Ola'}):
            response = self.client.post('/api/voice', files={'audio': ('voz.m4a', b'fake-audio', 'audio/mp4')})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['original'], 'Pryvit')
        self.assertEqual(response.json()['translation'], 'Ola')
        transcribe_mock.assert_called_once()

    def test_voice_wrong_type(self):
        self.sign_in()
        response = self.client.post('/api/voice', files={'audio': ('image.png', b'x', 'image/png')})
        self.assertEqual(response.status_code, 400)

    def test_logout(self):
        self.sign_in()
        self.assertEqual(self.client.post('/logout', follow_redirects=False).status_code, 303)
        self.assertEqual(self.client.get('/', follow_redirects=False).status_code, 303)

    def test_source_code_not_downloadable_as_asset(self):
        self.sign_in()
        for name in ('app.py', '.env.example', 'README.md', 'login.html'):
            self.assertEqual(self.client.get('/assets/' + name).status_code, 404)

    def test_no_api_key_returns_controlled_error(self):
        self.sign_in()
        with patch('app.API_KEY', ''):
            response = self.client.post('/api/translate', json={'text': 'Bom dia'})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('Traceback', response.text)

    def test_incorrect_translation_direction_rejected(self):
        fake = MagicMock()
        fake.responses.create.return_value.output_text = '{"detected_language":"pt","target_language":"pt","translation":"Errado"}'
        with patch('app._client', return_value=fake):
            with self.assertRaises(ValueError):
                translate_text('Bom dia')

    def test_correct_structured_output_and_no_storage(self):
        fake = MagicMock()
        fake.responses.create.return_value.output_text = '{"detected_language":"uk","target_language":"pt","translation":"Ola"}'
        with patch('app._client', return_value=fake):
            result = translate_text('Pryvit')
        self.assertEqual(result['target_language'], 'pt')
        opts = fake.responses.create.call_args.kwargs
        self.assertEqual(opts['model'], 'gpt-5-mini')
        self.assertEqual(opts['store'], False)
        self.assertEqual(opts['text']['format']['type'], 'json_schema')

    def test_transcription_model(self):
        fake = MagicMock()
        fake.audio.transcriptions.create.return_value.text = 'Bom dia'
        with patch('app._client', return_value=fake):
            result = transcribe_audio(b'raw', 'voz.m4a', 'audio/mp4')
        self.assertEqual(result, 'Bom dia')
        self.assertEqual(fake.audio.transcriptions.create.call_args.kwargs['model'], 'gpt-4o-mini-transcribe')


    def test_ukrainian_repeated_as_portuguese_rejected(self):
        with self.assertRaisesRegex(ValueError, 'continua em cirilico'):
            validate_translation('Привіт, як справи?', {'detected_language':'uk','target_language':'pt','translation':'Привіт, як справи?'})

    def test_portuguese_repeated_as_ukrainian_rejected(self):
        with self.assertRaisesRegex(ValueError, 'alfabeto latino'):
            validate_translation('Como estás hoje?', {'detected_language':'pt','target_language':'uk','translation':'Como estás hoje?'})

    def test_normal_two_way_translations_pass(self):
        self.assertEqual(validate_translation('Привіт, як справи?', {'detected_language':'uk','target_language':'pt','translation':'Olá, como estás?'})['translation'], 'Olá, como estás?')
        self.assertEqual(validate_translation('Como estás hoje?', {'detected_language':'pt','target_language':'uk','translation':'Як ти сьогодні?'})['translation'], 'Як ти сьогодні?')

    def test_incorrect_cyrillic_source_language_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Idioma de origem'):
            validate_translation('Привіт, як справи?', {'detected_language':'pt','target_language':'uk','translation':'Як ти сьогодні?'})

    def test_missing_translation_rejected(self):
        with self.assertRaisesRegex(ValueError, 'vazia'):
            validate_translation('Olá', {'detected_language':'pt','target_language':'uk','translation':''})

if __name__ == '__main__':
    unittest.main()


class MultilingualTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.post('/login', data={'access_code':'codigo-testes-123456'})
    def tearDown(self): self.client.close()
    def test_languages_in_interface(self):
        page = self.client.get('/').text
        self.assertIn('value="en"', page)
        self.assertIn('value="ko"', page)
    def test_invalid_pair_rejected(self):
        self.assertEqual(self.client.post('/api/translate', json={'text':'Bom dia','pair':'xx'}).status_code,400)
        self.assertEqual(self.client.post('/api/voice', data={'pair':'xx'},files={'audio':('a.m4a',b'test','audio/mp4')}).status_code,400)
    def test_english_portuguese_both_directions(self):
        self.assertEqual(validate_translation('Bom dia',{'detected_language':'pt','target_language':'en','translation':'Good morning'},'en')['translation'],'Good morning')
        self.assertEqual(validate_translation('Good morning',{'detected_language':'en','target_language':'pt','translation':'Bom dia'},'en')['translation'],'Bom dia')
    def test_korean_portuguese_both_directions(self):
        self.assertEqual(validate_translation('Bom dia',{'detected_language':'pt','target_language':'ko','translation':'좋은 아침'},'ko')['target_language'],'ko')
        self.assertEqual(validate_translation('안녕하세요',{'detected_language':'ko','target_language':'pt','translation':'Olá'},'ko')['target_language'],'pt')
    def test_cross_pair_rejected(self):
        with self.assertRaises(ValueError):
            validate_translation('Hello',{'detected_language':'en','target_language':'pt','translation':'Olá'},'ko')
    def test_pair_forwarded_text(self):
        with patch('app.translate_text',return_value={'detected_language':'pt','target_language':'ko','translation':'안녕'}) as m:
            r=self.client.post('/api/translate',json={'text':'Olá','pair':'ko'})
        self.assertEqual(r.status_code,200)
        m.assert_called_once_with('Olá','ko')
    def test_pair_forwarded_voice(self):
        with patch('app.transcribe_audio',return_value='Hello'),patch('app.translate_text',return_value={'detected_language':'en','target_language':'pt','translation':'Olá'}) as m:
            r=self.client.post('/api/voice',data={'pair':'en'},files={'audio':('voz.m4a',b'fake','audio/mp4')})
        self.assertEqual(r.status_code,200)
        m.assert_called_once_with('Hello','en')
