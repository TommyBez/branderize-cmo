import { createHmac } from 'node:crypto'
import type { CSSProperties } from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  render,
  Section,
  Text,
} from 'react-email'
import type { Resend } from 'resend'

const OTP_EXPIRY_MINUTES = 5
const OTP_EMAIL_TEMPLATE_VERSION = 'v1'

const styles = {
  body: {
    backgroundColor: '#f3f0e8',
    color: '#14221b',
    fontFamily: 'Arial, sans-serif',
    margin: '0',
  },
  brand: {
    fontSize: '18px',
    fontWeight: '700',
    margin: '0 0 32px',
  },
  code: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '34px',
    fontWeight: '700',
    letterSpacing: '0.18em',
    margin: '0',
    textAlign: 'center' as const,
  },
  codeContainer: {
    backgroundColor: '#ffffff',
    border: '1px solid #14221b',
    margin: '28px 0',
    padding: '18px 16px',
  },
  container: {
    boxSizing: 'border-box' as const,
    margin: '0 auto',
    maxWidth: '560px',
    padding: '48px 24px',
  },
  footer: {
    color: '#536159',
    fontSize: '13px',
    lineHeight: '1.6',
    margin: '0',
  },
  heading: {
    fontFamily: 'Georgia, serif',
    fontSize: '36px',
    lineHeight: '1.1',
    margin: '0 0 16px',
  },
  text: {
    fontSize: '16px',
    lineHeight: '1.6',
    margin: '0',
  },
} satisfies Readonly<Record<string, CSSProperties>>

export interface EmailOtpEmailProps {
  readonly otp: string
}

export const EmailOtpEmail = ({ otp }: EmailOtpEmailProps) => (
  <Html lang="it">
    <Head />
    <Body style={styles.body}>
      <Preview>Il tuo codice di accesso a Branderize è {otp}</Preview>
      <Container style={styles.container}>
        <Text style={styles.brand}>Branderize</Text>
        <Heading as="h1" style={styles.heading}>
          Il tuo codice di accesso
        </Heading>
        <Text style={styles.text}>
          Inserisci questo codice nella schermata di accesso. Scade tra{' '}
          {OTP_EXPIRY_MINUTES} minuti e può essere usato una sola volta.
        </Text>
        <Section style={styles.codeContainer}>
          <Text style={styles.code}>{otp}</Text>
        </Section>
        <Text style={styles.footer}>
          Se non hai richiesto tu questo codice, ignora l&apos;email e non
          condividerlo con altre persone.
        </Text>
      </Container>
    </Body>
  </Html>
)

EmailOtpEmail.PreviewProps = {
  otp: '731204',
} satisfies EmailOtpEmailProps

export type EmailOtpClient = Pick<Resend['emails'], 'send'>

export const createEmailOtpIdempotencyKey = ({
  email,
  fromEmail,
  idempotencySecret,
  otp,
}: {
  readonly email: string
  readonly fromEmail: string
  readonly idempotencySecret: string
  readonly otp: string
}): string => {
  const digest = createHmac('sha256', idempotencySecret)
    .update(
      JSON.stringify([
        OTP_EMAIL_TEMPLATE_VERSION,
        fromEmail.trim().toLowerCase(),
        email.trim().toLowerCase(),
        otp,
      ])
    )
    .digest('hex')

  return `sign-in-email-otp/${digest}`
}

export const sendEmailOtpEmail = async ({
  client,
  email,
  fromEmail,
  idempotencySecret,
  otp,
}: {
  readonly client: EmailOtpClient
  readonly email: string
  readonly fromEmail: string
  readonly idempotencySecret: string
  readonly otp: string
}): Promise<void> => {
  const emailTemplate = <EmailOtpEmail otp={otp} />
  const plainText = await render(emailTemplate, { plainText: true })
  const result = await client.send(
    {
      from: `Branderize <${fromEmail}>`,
      react: emailTemplate,
      subject: 'Il tuo codice di accesso a Branderize',
      text: plainText,
      to: email,
    },
    {
      idempotencyKey: createEmailOtpIdempotencyKey({
        email,
        fromEmail,
        idempotencySecret,
        otp,
      }),
    }
  )

  if (result.error !== null) {
    throw new Error('Resend could not deliver the access-code email')
  }
}
