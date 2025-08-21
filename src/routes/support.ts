// src/routes/support.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { supabaseServiceClient } from '../lib/supabase'
import { Resend } from 'resend'

// Types pour la validation
interface SupportContactBody {
  name: string
  email: string
  subject: string
  message: string
  category: string
}

// Configuration Resend
const resend = new Resend(process.env.RESEND_API_KEY)

export default async function supportRoutes(fastify: FastifyInstance) {
  
  // ✅ POST /support/contact - Envoyer message support
  fastify.post<{
    Body: SupportContactBody
  }>('/contact', async (request: FastifyRequest<{ Body: SupportContactBody }>, reply: FastifyReply) => {
    try {
      const { name, email, subject, message, category } = request.body

      // Validation des champs requis
      if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim() || !category?.trim()) {
        return reply.code(400).send({
          success: false,
          error: 'Tous les champs sont requis'
        })
      }

      // Validation email simple
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        return reply.code(400).send({
          success: false,
          error: 'Email invalide'
        })
      }

      // Sauvegarder en base de données
      const { data: supportMessage, error: dbError } = await supabaseServiceClient
        .from('support_messages')
        .insert({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          subject: subject.trim(),
          message: message.trim(),
          category: category.trim()
        })
        .select()
        .single()

      if (dbError) {
        // ✅ CORRECTION TYPESCRIPT - Objet en premier
        fastify.log.error({ error: dbError }, 'Erreur DB support')
        return reply.code(500).send({ 
          success: false,
          error: 'Erreur de sauvegarde' 
        })
      }

      // Email au support
      const supportEmailData = {
        from: 'ChatSeller Support <noreply@chatseller.app>',
        to: ['support@chatseller.app'],
        subject: `[${category.toUpperCase()}] ${subject}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; padding: 20px;">
            <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
              <h2 style="color: white; margin: 0; font-size: 24px;">📧 Nouveau message support</h2>
              <p style="color: #bfdbfe; margin: 5px 0 0 0;">ChatSeller - Support Client</p>
            </div>
            
            <div style="background: #f8fafc; padding: 20px; margin: 0; border-left: 4px solid #2563eb;">
              <h3 style="margin-top: 0; color: #1e293b;">📋 Informations du contact</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #475569;">👤 Nom :</td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #475569;">📧 Email :</td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${email}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #475569;">🏷️ Catégorie :</td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${category}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #475569;">📝 Sujet :</td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${subject}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #475569;">🆔 ID Message :</td>
                  <td style="padding: 8px 0; color: #1e293b; font-family: monospace;">${supportMessage.id}</td>
                </tr>
              </table>
            </div>
            
            <div style="background: white; padding: 20px; border: 2px solid #e2e8f0; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #1e293b; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px;">💬 Message du client</h3>
              <p style="white-space: pre-wrap; line-height: 1.6; color: #374151; background: #f8fafc; padding: 15px; border-radius: 6px; border-left: 4px solid #3b82f6;">${message}</p>
            </div>
            
            <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 15px; border-radius: 8px; text-align: center; margin-top: 20px;">
              <p style="margin: 0; color: white; font-weight: bold;">
                ⚡ Répondre directement à : <a href="mailto:${email}" style="color: #dcfce7; text-decoration: underline;">${email}</a>
              </p>
              <p style="margin: 5px 0 0 0; color: #a7f3d0; font-size: 14px;">
                🎯 Objectif de réponse : 2h en moyenne
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                📨 Email automatique généré par ChatSeller API<br>
                🕒 ${new Date().toLocaleString('fr-FR')}
              </p>
            </div>
          </div>
        `
      }

      // Email de confirmation au client
      const confirmationEmailData = {
        from: 'ChatSeller Support <noreply@chatseller.app>',
        to: [email],
        subject: '✅ Votre message a été reçu - ChatSeller Support',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h2 style="color: white; margin: 0; font-size: 28px;">✅ Message reçu !</h2>
              <p style="color: #bfdbfe; margin: 10px 0 0 0; font-size: 16px;">Merci d'avoir contacté ChatSeller</p>
            </div>
            
            <div style="padding: 30px;">
              <p style="font-size: 18px; color: #1e293b; margin-top: 0;">Bonjour <strong>${name}</strong>,</p>
              
              <p style="color: #475569; line-height: 1.6;">
                Nous avons bien reçu votre message concernant : <strong style="color: #2563eb;">"${subject}"</strong>
              </p>
              
              <div style="background: linear-gradient(135deg, #eff6ff, #dbeafe); padding: 20px; border-radius: 12px; margin: 25px 0; border: 1px solid #93c5fd;">
                <h3 style="margin-top: 0; color: #1e40af; font-size: 18px;">📋 Récapitulatif de votre demande</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-weight: bold; color: #374151;">🆔 Référence :</td>
                    <td style="padding: 8px 0; color: #1e293b; font-family: monospace;">#${supportMessage.id.slice(0, 8)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏷️ Catégorie :</td>
                    <td style="padding: 8px 0; color: #1e293b;">${category}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; font-weight: bold; color: #374151;">⏱️ Temps de réponse :</td>
                    <td style="padding: 8px 0; color: #1e293b;">2 heures en moyenne</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; font-weight: bold; color: #374151;">📧 Email de suivi :</td>
                    <td style="padding: 8px 0; color: #1e293b;">support@chatseller.app</td>
                  </tr>
                </table>
              </div>
              
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h4 style="color: #15803d; margin-top: 0; display: flex; align-items: center;">
                  🚀 Prochaines étapes
                </h4>
                <ul style="color: #166534; margin: 10px 0; padding-left: 20px;">
                  <li style="margin-bottom: 8px;">Notre équipe technique examine votre demande</li>
                  <li style="margin-bottom: 8px;">Vous recevrez une réponse personnalisée sous 2h</li>
                  <li style="margin-bottom: 8px;">Toute correspondance utilisera la référence #${supportMessage.id.slice(0, 8)}</li>
                </ul>
              </div>
              
              <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 15px; margin: 25px 0;">
                <p style="margin: 0; color: #92400e; font-size: 14px;">
                  <strong>💡 Conseil :</strong> Ajoutez support@chatseller.app à vos contacts pour éviter que nos réponses arrivent en spam.
                </p>
              </div>
              
              <p style="color: #475569; line-height: 1.6;">
                En attendant, n'hésitez pas à consulter notre <a href="https://chatseller.app/support" style="color: #2563eb; text-decoration: none;">centre d'aide</a> qui contient les réponses aux questions les plus fréquentes.
              </p>
              
              <p style="color: #475569; line-height: 1.6;">
                Merci d'utiliser ChatSeller pour booster vos ventes ! 🚀
              </p>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; margin: 0;"><strong>L'équipe ChatSeller</strong></p>
                <p style="color: #9ca3af; font-size: 14px; margin: 5px 0 0 0;">
                  📧 support@chatseller.app | 🌐 chatseller.app
                </p>
              </div>
            </div>
            
            <div style="background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Cet email a été envoyé automatiquement. Ne pas répondre à cet email.<br>
                Pour toute question, contactez-nous directement sur support@chatseller.app
              </p>
            </div>
          </div>
        `
      }

      // Envoyer les emails en parallèle
      try {
        await Promise.all([
          resend.emails.send(supportEmailData),
          resend.emails.send(confirmationEmailData)
        ])

        fastify.log.info(`Support message sent successfully: ${supportMessage.id}`)
      } catch (emailError) {
        // ✅ CORRECTION TYPESCRIPT - Objet en premier
        fastify.log.error({ error: emailError }, 'Erreur envoi email')
        // Ne pas faire échouer la requête si l'email échoue
        // Le message est déjà sauvé en base
      }

      return reply.send({
        success: true,
        messageId: supportMessage.id,
        message: 'Message envoyé avec succès'
      })

    } catch (error: any) {
      fastify.log.error({ error: error }, 'Erreur support contact')
      return reply.code(500).send({
        success: false,
        error: 'Erreur lors de l\'envoi du message'
      })
    }
  })

  // ✅ GET /support/status/:messageId - Vérifier le statut d'un message (optionnel)
  fastify.get<{
    Params: { messageId: string }
  }>('/status/:messageId', async (request: FastifyRequest<{ Params: { messageId: string } }>, reply: FastifyReply) => {
    try {
      const { messageId } = request.params

      const { data: message, error } = await supabaseServiceClient
        .from('support_messages')
        .select('id, status, created_at, category, subject')
        .eq('id', messageId)
        .single()

      if (error || !message) {
        return reply.code(404).send({
          success: false,
          error: 'Message non trouvé'
        })
      }

      return reply.send({
        success: true,
        message: {
          id: message.id,
          status: message.status,
          createdAt: message.created_at,
          category: message.category,
          subject: message.subject
        }
      })

    } catch (error: any) {
      fastify.log.error({ error: error }, 'Erreur support status')
      return reply.code(500).send({
        success: false,
        error: 'Erreur lors de la vérification du statut'
      })
    }
  })
}